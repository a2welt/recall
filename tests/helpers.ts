import { DatabaseSync } from "node:sqlite";

export function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id          TEXT PRIMARY KEY,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      source      TEXT NOT NULL CHECK(source IN ('cli','ingested','mcp')),
      source_path TEXT,
      status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','archived'))
      ,priority TEXT DEFAULT 'medium'
      ,category TEXT DEFAULT 'note'
      ,topic TEXT
      ,project_id TEXT
      ,workflow_status TEXT DEFAULT 'backlog'
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
    CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);

    CREATE TABLE IF NOT EXISTS idea_embeddings (
      idea_id   TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,
      embedding TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_ideas USING fts5(
      idea_id UNINDEXED,
      content,
      tokenize = 'porter ascii'
    );
  `);

  return db;
}

/** Deterministic unit-length 384-dim embedding from a seed. */
export function fakeEmbedding(seed: number): number[] {
  const arr = new Array<number>(384);
  for (let i = 0; i < 384; i++) arr[i] = Math.sin(seed * 0.1 + i * 0.01);
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  return arr.map((v) => v / norm);
}
