/**
 * SQLite database layer — node:sqlite (Node 22.5+, no native addon).
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import envPaths from "env-paths";
import type {
  Idea, IdeaContext, IdeaSource, IdeaStatus, IdeaPriority, IdeaCategory, Project, WorkflowStatus, DecisionMetadata,
  IdeaLink, LinkRelation,
} from "../types.js";
import { LINK_RELATIONS } from "../types.js";
import { inferTopic } from "../topic.js";
import { extractEvidenceReferences, parseReference } from "../links/references.js";

// ─── DB path ──────────────────────────────────────────────────────────────────

function resolveDbPath(override?: string): string {
  if (override) return override;
  const paths = envPaths("recall", { suffix: "" });
  return join(paths.data, "recall.db");
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _db: DatabaseSync | null = null;

export function getDb(dbPath?: string): DatabaseSync {
  if (_db) return _db;
  const resolved = resolveDbPath(dbPath);
  mkdirSync(dirname(resolved), { recursive: true });
  _db = new DatabaseSync(resolved);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");
  runMigrations(_db);
  return _db;
}

export function closeDb(): void {
  if (_db) { _db.close(); _db = null; }
}

export function setDb(db: DatabaseSync): void { _db = db; }

// ─── Migrations ───────────────────────────────────────────────────────────────

export function runMigrations(db: DatabaseSync): void {
  // Core schema — does NOT reference priority/category so it is safe against
  // existing databases that predate those columns.
  db.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id          TEXT PRIMARY KEY,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      source      TEXT NOT NULL CHECK(source IN ('cli','ingested','mcp')),
      source_path TEXT,
      status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','archived'))
    );

    CREATE TABLE IF NOT EXISTS idea_context (
      idea_id     TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
      repo_path   TEXT,
      branch      TEXT,
      file_path   TEXT,
      line_start  INTEGER,
      line_end    INTEGER,
      commit_hash TEXT,
      error_text  TEXT
    );

    CREATE TABLE IF NOT EXISTS idea_decisions (
      idea_id      TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
      decision     TEXT,
      why          TEXT,
      alternatives TEXT,
      tradeoffs    TEXT,
      evidence     TEXT,
      outcome      TEXT
    );

    CREATE TABLE IF NOT EXISTS idea_embeddings (
      idea_id   TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
      embedding TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_ideas USING fts5(
      idea_id UNINDEXED,
      content,
      tokenize = 'porter ascii'
    );

    CREATE INDEX IF NOT EXISTS idx_ideas_status   ON ideas(status);
    CREATE INDEX IF NOT EXISTS idx_ideas_source   ON ideas(source);
    CREATE INDEX IF NOT EXISTS idx_context_repo   ON idea_context(repo_path);
    CREATE INDEX IF NOT EXISTS idx_context_branch ON idea_context(branch);

    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      color      TEXT NOT NULL DEFAULT '#6674ef',
      status     TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Additive migrations — each is independent; catch swallows "already exists".
  // NOTE: idx_ideas_priority must be created AFTER the column exists, so it
  // lives here rather than in the block above.
  try { db.exec(`ALTER TABLE ideas ADD COLUMN priority TEXT DEFAULT 'medium'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ideas ADD COLUMN category TEXT DEFAULT 'note'`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ideas ADD COLUMN topic TEXT`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ideas ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`); } catch { /* already exists */ }
  try { db.exec(`ALTER TABLE ideas ADD COLUMN workflow_status TEXT DEFAULT 'backlog'`); } catch { /* already exists */ }
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_ideas_priority ON ideas(priority)`); } catch { /* already exists */ }

  migrateIdeaLinks(db);
}

/**
 * Links from a memory to shared reference URIs (receipts, code, model calls, …).
 * When the table is first created, references already sitting in decision
 * `evidence` fields are backfilled as `related` links. The backfill runs once, so
 * a link the user later removes is not re-created on the next start.
 */
export function migrateIdeaLinks(db: DatabaseSync): void {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'idea_links'`).get();
  if (exists) return;
  const relations = LINK_RELATIONS.map((relation) => `'${relation}'`).join(",");
  withTransaction(db, () => {
    db.exec(`
      CREATE TABLE idea_links (
        memory_id  TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
        reference  TEXT NOT NULL,
        relation   TEXT NOT NULL DEFAULT 'related' CHECK(relation IN (${relations})),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (memory_id, reference, relation)
      );
      CREATE INDEX idx_links_reference ON idea_links(reference);
    `);
    backfillEvidenceLinks(db);
  });
}

// ─── Transaction helper ───────────────────────────────────────────────────────

function withTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec("BEGIN");
  try { fn(); db.exec("COMMIT"); }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

// ─── Write helpers ────────────────────────────────────────────────────────────

export interface InsertIdeaOpts {
  id: string;
  content: string;
  source: IdeaSource;
  source_path?: string | null;
  status?: IdeaStatus;
  priority?: IdeaPriority;
  category?: IdeaCategory;
  topic?: string;
  project_id?: string | null;
  workflow_status?: WorkflowStatus;
  context?: {
    repo_path?: string | null;
    branch?: string | null;
    file_path?: string | null;
    line_start?: number | null;
    line_end?: number | null;
    commit_hash?: string | null;
    error_text?: string | null;
  };
  decision?: DecisionMetadata;
  /** Optional dense embedding stored for future semantic search. */
  embedding?: number[];
}

function cleanOptionalText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

export function buildIdeaSearchText(input: { content: string } & Partial<DecisionMetadata>): string {
  return [
    input.content,
    input.decision && `Decision: ${input.decision}`,
    input.why && `Why: ${input.why}`,
    input.alternatives && `Alternatives rejected: ${input.alternatives}`,
    input.tradeoffs && `Tradeoffs: ${input.tradeoffs}`,
    input.evidence && `Evidence: ${input.evidence}`,
    input.outcome && `Outcome: ${input.outcome}`,
  ].filter(Boolean).join("\n");
}

export function insertIdea(db: DatabaseSync, opts: InsertIdeaOpts): void {
  const ctx = opts.context ?? {};
  const decision = {
    decision: cleanOptionalText(opts.decision?.decision),
    why: cleanOptionalText(opts.decision?.why),
    alternatives: cleanOptionalText(opts.decision?.alternatives),
    tradeoffs: cleanOptionalText(opts.decision?.tradeoffs),
    evidence: cleanOptionalText(opts.decision?.evidence),
    outcome: cleanOptionalText(opts.decision?.outcome),
  };
  const hasDecisionMetadata = Object.values(decision).some(Boolean);
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO ideas (id, content, source, source_path, status, priority, category, topic, project_id, workflow_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opts.id, opts.content, opts.source,
      opts.source_path ?? null,
      opts.status   ?? "open",
      opts.priority ?? "medium",
      opts.category ?? "note",
      opts.topic?.trim() || inferTopic(opts.content),
      opts.project_id ?? null,
      opts.workflow_status ?? "backlog"
    );

    db.prepare(
      `INSERT INTO idea_context
         (idea_id, repo_path, branch, file_path, line_start, line_end, commit_hash, error_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      opts.id,
      ctx.repo_path ?? null, ctx.branch ?? null, ctx.file_path ?? null,
      ctx.line_start ?? null, ctx.line_end ?? null,
      ctx.commit_hash ?? null, ctx.error_text ?? null
    );

    if (hasDecisionMetadata) {
      db.prepare(
        `INSERT INTO idea_decisions
           (idea_id, decision, why, alternatives, tradeoffs, evidence, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        opts.id,
        decision.decision, decision.why, decision.alternatives,
        decision.tradeoffs, decision.evidence, decision.outcome
      );
    }

    insertEvidenceLinks(db, opts.id, decision.evidence);

    if (opts.embedding) {
      db.prepare(`INSERT INTO idea_embeddings (idea_id, embedding) VALUES (?, ?)`)
        .run(opts.id, JSON.stringify(opts.embedding));
    }

    db.prepare(`INSERT INTO fts_ideas(idea_id, content) VALUES (?, ?)`)
      .run(opts.id, buildIdeaSearchText({ content: opts.content, ...decision }));
  });
}

export function resolveIdea(db: DatabaseSync, id: string): boolean {
  const result = db.prepare(
    `UPDATE ideas SET status = 'resolved', updated_at = datetime('now') WHERE id = ?`
  ).run(id) as { changes: number };
  return result.changes > 0;
}

export function clearIdeaContext(db: DatabaseSync, id: string): boolean {
  const result = db.prepare(
    `UPDATE idea_context SET repo_path = NULL, branch = NULL, file_path = NULL,
      line_start = NULL, line_end = NULL, commit_hash = NULL, error_text = NULL
     WHERE idea_id = ?`
  ).run(id) as { changes: number };
  return result.changes > 0;
}

// ─── Read helpers ─────────────────────────────────────────────────────────────

export interface IdeaRow extends Idea {
  repo_path:   string | null;
  branch:      string | null;
  file_path:   string | null;
  line_start:  number | null;
  line_end:    number | null;
  commit_hash: string | null;
  error_text:  string | null;
}

const IDEA_SQL = `
  SELECT
    i.id, i.content, i.created_at, i.updated_at,
    d.decision, d.why, d.alternatives, d.tradeoffs, d.evidence, d.outcome,
    i.source, i.source_path, i.status,
    COALESCE(i.priority, 'medium') AS priority,
    COALESCE(i.category, 'note')   AS category,
    COALESCE(NULLIF(i.topic, ''), '') AS topic,
    i.project_id,
    COALESCE(i.workflow_status, 'backlog') AS workflow_status,
    c.repo_path, c.branch, c.file_path,
    c.line_start, c.line_end, c.commit_hash, c.error_text
  FROM ideas i
  LEFT JOIN idea_context c ON c.idea_id = i.id
  LEFT JOIN idea_decisions d ON d.idea_id = i.id
`;

export function getIdeaById(db: DatabaseSync, id: string): IdeaRow | undefined {
  return db.prepare(`${IDEA_SQL} WHERE i.id = ?`).get(id) as unknown as IdeaRow | undefined;
}

export function listIdeas(
  db: DatabaseSync,
  opts: { repo?: string; onlyOpen?: boolean } = {}
): IdeaRow[] {
  const conditions: string[] = [];
  const params: string[] = [];
  if (opts.onlyOpen) conditions.push("i.status = 'open'");
  if (opts.repo) { conditions.push("c.repo_path = ?"); params.push(opts.repo); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.prepare(`${IDEA_SQL} ${where} ORDER BY i.created_at DESC`)
    .all(...params) as unknown as IdeaRow[];
}

export function getIngestedSourcePaths(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare(
    `SELECT source_path, updated_at FROM ideas WHERE source = 'ingested' AND source_path IS NOT NULL`
  ).all() as unknown as { source_path: string; updated_at: string }[];
  return new Map(rows.map((r) => [r.source_path, r.updated_at]));
}

export function getIdeasByIds(db: DatabaseSync, ids: string[]): IdeaRow[] {
  if (!ids.length) return [];
  const ph = ids.map(() => "?").join(",");
  return db.prepare(`${IDEA_SQL} WHERE i.id IN (${ph})`)
    .all(...ids) as unknown as IdeaRow[];
}

export function getRecentIdeas(db: DatabaseSync, limit: number, repoPath?: string): IdeaRow[] {
  if (repoPath) {
    return db.prepare(`${IDEA_SQL} WHERE c.repo_path = ? ORDER BY i.created_at DESC LIMIT ?`)
      .all(repoPath, limit) as unknown as IdeaRow[];
  }
  return db.prepare(`${IDEA_SQL} ORDER BY i.created_at DESC LIMIT ?`)
    .all(limit) as unknown as IdeaRow[];
}

export function getIdeaContext(db: DatabaseSync, ideaId: string): IdeaContext | null {
  const row = db.prepare(`SELECT * FROM idea_context WHERE idea_id = ?`)
    .get(ideaId) as unknown as IdeaContext | undefined;
  return row ?? null;
}

export function listProjects(db: DatabaseSync): Array<Project & { memory_count: number; active_count: number }> {
  return db.prepare(`
    SELECT p.*, COUNT(i.id) AS memory_count,
      SUM(CASE WHEN i.workflow_status = 'active' THEN 1 ELSE 0 END) AS active_count
    FROM projects p LEFT JOIN ideas i ON i.project_id = p.id
    GROUP BY p.id ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, p.updated_at DESC
  `).all() as unknown as Array<Project & { memory_count: number; active_count: number }>;
}

export function createProject(db: DatabaseSync, project: { id: string; name: string; color: string }): Project {
  db.prepare(`INSERT INTO projects (id, name, color) VALUES (?, ?, ?)`).run(project.id, project.name, project.color);
  return db.prepare(`SELECT * FROM projects WHERE id = ?`).get(project.id) as unknown as Project;
}

export function updateProjectStatus(db: DatabaseSync, id: string, status: Project["status"]): boolean {
  const result = db.prepare(`UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, id) as { changes: number };
  return result.changes > 0;
}

export function updateIdeaWorkflow(db: DatabaseSync, id: string, workflowStatus: WorkflowStatus): boolean {
  const result = db.prepare(`UPDATE ideas SET workflow_status = ?, updated_at = datetime('now') WHERE id = ?`).run(workflowStatus, id) as { changes: number };
  return result.changes > 0;
}

export function assignIdeaProject(db: DatabaseSync, id: string, projectId: string | null): boolean {
  const result = db.prepare(`UPDATE ideas SET project_id = ?, updated_at = datetime('now') WHERE id = ?`).run(projectId, id) as { changes: number };
  return result.changes > 0;
}

export function deleteIdea(db: DatabaseSync, id: string): boolean {
  let changed = false;
  withTransaction(db, () => {
    db.prepare(`DELETE FROM fts_ideas WHERE idea_id = ?`).run(id);
    const result = db.prepare(`DELETE FROM ideas WHERE id = ?`).run(id) as { changes: number };
    changed = result.changes > 0;
  });
  return changed;
}

// ─── Links to shared references ───────────────────────────────────────────────

export class InvalidLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLinkError";
  }
}

export function isLinkRelation(value: unknown): value is LinkRelation {
  return typeof value === "string" && (LINK_RELATIONS as readonly string[]).includes(value);
}

function checkRelation(relation: unknown): LinkRelation {
  if (!isLinkRelation(relation)) throw new InvalidLinkError(`relation must be one of: ${LINK_RELATIONS.join(", ")}`);
  return relation;
}

function checkReference(reference: unknown) {
  try { return parseReference(reference as string); }
  catch (e) { throw new InvalidLinkError((e as Error).message); }
}

/** `related` links for the reference URIs on their own lines in `evidence`. */
function insertEvidenceLinks(db: DatabaseSync, memoryId: string, evidence: string | null | undefined): number {
  const statement = db.prepare(`INSERT OR IGNORE INTO idea_links (memory_id, reference, relation) VALUES (?, ?, 'related')`);
  let added = 0;
  for (const reference of extractEvidenceReferences(evidence)) {
    if (reference === `recall:memory:${memoryId}`) continue;
    added += (statement.run(memoryId, reference) as { changes: number }).changes;
  }
  return added;
}

/** Create `related` links for every evidence reference. Idempotent; returns links added. */
export function backfillEvidenceLinks(db: DatabaseSync): number {
  const rows = db.prepare(`SELECT idea_id, evidence FROM idea_decisions WHERE evidence IS NOT NULL`)
    .all() as unknown as Array<{ idea_id: string; evidence: string }>;
  return rows.reduce((added, row) => added + insertEvidenceLinks(db, row.idea_id, row.evidence), 0);
}

/** Full memory id for an id or unique prefix; undefined when none or ambiguous. */
export function resolveIdeaId(db: DatabaseSync, idOrPrefix: string): string | undefined {
  if (!idOrPrefix) return undefined;
  if (db.prepare(`SELECT 1 FROM ideas WHERE id = ?`).get(idOrPrefix)) return idOrPrefix;
  const matches = db.prepare(`SELECT id FROM ideas WHERE substr(id, 1, ?) = ? LIMIT 2`)
    .all(idOrPrefix.length, idOrPrefix) as unknown as Array<{ id: string }>;
  return matches.length === 1 ? matches[0].id : undefined;
}

/**
 * Link a memory to a reference URI. Returns undefined when the memory does not
 * exist; `created` is false when the same link was already there.
 */
export function addIdeaLink(
  db: DatabaseSync,
  memoryId: string,
  reference: string,
  relation: LinkRelation = "related"
): { link: IdeaLink; created: boolean } | undefined {
  const ref = checkReference(reference).reference;
  const rel = checkRelation(relation);
  if (!db.prepare(`SELECT 1 FROM ideas WHERE id = ?`).get(memoryId)) return undefined;
  if (ref === `recall:memory:${memoryId}`) throw new InvalidLinkError("a memory cannot link to itself");
  const result = db.prepare(`INSERT OR IGNORE INTO idea_links (memory_id, reference, relation) VALUES (?, ?, ?)`)
    .run(memoryId, ref, rel) as { changes: number };
  const link = db.prepare(`SELECT memory_id, reference, relation, created_at FROM idea_links WHERE memory_id = ? AND reference = ? AND relation = ?`)
    .get(memoryId, ref, rel) as unknown as IdeaLink;
  return { link, created: result.changes > 0 };
}

/** Remove a link; without a relation, every relation to that reference. Returns links removed. */
export function removeIdeaLink(db: DatabaseSync, memoryId: string, reference: string, relation?: LinkRelation): number {
  const ref = typeof reference === "string" ? reference.trim() : "";
  if (!ref) throw new InvalidLinkError("reference is required");
  if (relation === undefined) {
    return (db.prepare(`DELETE FROM idea_links WHERE memory_id = ? AND reference = ?`).run(memoryId, ref) as { changes: number }).changes;
  }
  return (db.prepare(`DELETE FROM idea_links WHERE memory_id = ? AND reference = ? AND relation = ?`)
    .run(memoryId, ref, checkRelation(relation)) as { changes: number }).changes;
}

export function listIdeaLinks(db: DatabaseSync, memoryId: string): IdeaLink[] {
  return db.prepare(`SELECT memory_id, reference, relation, created_at FROM idea_links WHERE memory_id = ? ORDER BY created_at, reference, relation`)
    .all(memoryId) as unknown as IdeaLink[];
}

/** Every link, for drawing the whole memory graph. */
export function listAllLinks(db: DatabaseSync, relation?: LinkRelation): IdeaLink[] {
  const where = relation === undefined ? "" : "WHERE relation = ?";
  const params = relation === undefined ? [] : [checkRelation(relation)];
  return db.prepare(`SELECT memory_id, reference, relation, created_at FROM idea_links ${where} ORDER BY created_at, memory_id, reference, relation`)
    .all(...params) as unknown as IdeaLink[];
}

export interface LinkedMemory extends IdeaLink {
  memory: Pick<Idea, "id" | "content" | "decision" | "status" | "category" | "topic" | "created_at">;
}

export interface LinkSearch {
  reference: string;
  /** `path` when a code reference without a line range also matched that path's line ranges. */
  match: "exact" | "path";
  links: LinkedMemory[];
}

type LinkedMemoryRow = IdeaLink & Pick<Idea, "content" | "decision" | "status" | "category" | "topic"> & { memory_created_at: string };

/**
 * Memories linked to a reference. A code reference without a line range
 * (`git+<url>@<commit>#<path>`) also matches the same path with any line range,
 * so "which decisions mention this file" finds line-level links too.
 */
export function findLinksByReference(db: DatabaseSync, reference: string, relation?: LinkRelation): LinkSearch {
  const parsed = checkReference(reference);
  const ref = parsed.reference;
  const byPath = parsed.kind === "code" && !parsed.has_line_range;
  // `<path>:L…` sorts between `<path>:L` and `<path>:M`, so the range test can use the index.
  const conditions = [byPath ? `(l.reference = ? OR (l.reference > ? AND l.reference < ?))` : `l.reference = ?`];
  const params: string[] = byPath ? [ref, `${ref}:L`, `${ref}:M`] : [ref];
  if (relation !== undefined) { conditions.push(`l.relation = ?`); params.push(checkRelation(relation)); }
  const rows = db.prepare(`
    SELECT l.memory_id, l.reference, l.relation, l.created_at,
      i.content, d.decision, i.status, COALESCE(i.category, 'note') AS category,
      COALESCE(i.topic, '') AS topic, i.created_at AS memory_created_at
    FROM idea_links l
    JOIN ideas i ON i.id = l.memory_id
    LEFT JOIN idea_decisions d ON d.idea_id = l.memory_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY l.created_at DESC, l.memory_id, l.reference, l.relation
  `).all(...params) as unknown as LinkedMemoryRow[];
  return {
    reference: ref,
    match: byPath ? "path" : "exact",
    links: rows.map((row) => ({
      memory_id: row.memory_id, reference: row.reference, relation: row.relation, created_at: row.created_at,
      memory: {
        id: row.memory_id, content: row.content, decision: row.decision ?? null, status: row.status,
        category: row.category, topic: row.topic, created_at: row.memory_created_at,
      },
    })),
  };
}

// ─── FTS5 search ──────────────────────────────────────────────────────────────

export interface FtsSearchResult { idea_id: string; rank: number; }

export function ftsSearch(db: DatabaseSync, query: string, limit = 20): FtsSearchResult[] {
  const safe = query.replace(/["'()*:^]/g, " ").trim();
  if (!safe) return [];
  try {
    return db.prepare(
      `SELECT idea_id, rank FROM fts_ideas WHERE fts_ideas MATCH ? ORDER BY rank LIMIT ?`
    ).all(safe, limit) as unknown as FtsSearchResult[];
  } catch { return []; }
}

// ─── Vector search (optional — when embeddings stored) ────────────────────────

export interface VecSearchResult { idea_id: string; distance: number; }

export function vectorSearch(db: DatabaseSync, q: number[], limit = 20): VecSearchResult[] {
  const rows = db.prepare(`SELECT idea_id, embedding FROM idea_embeddings`)
    .all() as unknown as { idea_id: string; embedding: string }[];
  if (!rows.length) return [];
  const scored = rows.map((r) => ({
    idea_id: r.idea_id,
    distance: cosDist(q, JSON.parse(r.embedding) as number[]),
  }));
  return scored
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export function listIdeasWithoutEmbeddings(db: DatabaseSync): Array<{ id: string; content: string }> {
  return db.prepare(`
    SELECT i.id,
      trim(i.content || char(10) ||
        COALESCE('Decision: ' || d.decision || char(10), '') ||
        COALESCE('Why: ' || d.why || char(10), '') ||
        COALESCE('Alternatives rejected: ' || d.alternatives || char(10), '') ||
        COALESCE('Tradeoffs: ' || d.tradeoffs || char(10), '') ||
        COALESCE('Evidence: ' || d.evidence || char(10), '') ||
        COALESCE('Outcome: ' || d.outcome, '')
      ) AS content
    FROM ideas i
    LEFT JOIN idea_embeddings e ON e.idea_id = i.id
    LEFT JOIN idea_decisions d ON d.idea_id = i.id
    WHERE e.idea_id IS NULL
    ORDER BY i.created_at ASC
  `).all() as unknown as Array<{ id: string; content: string }>;
}

export function saveIdeaEmbedding(db: DatabaseSync, ideaId: string, embedding: number[]): void {
  db.prepare(`INSERT OR REPLACE INTO idea_embeddings (idea_id, embedding) VALUES (?, ?)`)
    .run(ideaId, JSON.stringify(embedding));
}

// ─── Cosine distance helper ───────────────────────────────────────────────────

function cosDist(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 1;
  return 1 - dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
