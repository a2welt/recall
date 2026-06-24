/**
 * Recall ranking engine.
 *
 * Blends repository/file context, FTS5 keywords, on-device semantic
 * similarity, status, and recency into one explainable score.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  ftsSearch,
  getIdeasByIds,
  getRecentIdeas,
  vectorSearch,
} from "../db/index.js";
import type { IdeaRow } from "../db/index.js";
import type { RecalledIdea, RecallContext } from "../types.js";

const W_CONTEXT  = 0.35;
const W_KEYWORD  = 0.30;
const W_SEMANTIC = 0.20;
const W_RECENCY  = 0.10;
const W_STATUS   = 0.05;

const CONTEXT_SAME_FILE   = 1.0;
const CONTEXT_SAME_BRANCH = 0.7;
const CONTEXT_SAME_REPO   = 0.4;
const RECENCY_HALF_LIFE_DAYS = 14;

function contextScore(
  idea: IdeaRow,
  ctx: RecallContext
): { score: number; reason: string } {
  const { repo, branch, file } = ctx;
  const sameRepo = Boolean(repo && idea.repo_path && norm(repo) === norm(idea.repo_path));
  if (file && idea.file_path && norm(file) === norm(idea.file_path) && (!repo || sameRepo))
    return { score: CONTEXT_SAME_FILE, reason: `same file (${basename(idea.file_path)})` };
  if (branch && idea.branch && branch === idea.branch && (!repo || sameRepo))
    return { score: CONTEXT_SAME_BRANCH, reason: `same branch (${idea.branch})` };
  if (sameRepo)
    return { score: CONTEXT_SAME_REPO, reason: "same repo" };
  return { score: 0, reason: "" };
}

function recencyScore(updatedAt: string): number {
  const ageDays = (Date.now() - new Date(updatedAt).getTime()) / 86_400_000;
  return Math.pow(0.5, ageDays / RECENCY_HALF_LIFE_DAYS);
}

function norm(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase().replace(/\/$/, "");
}
function basename(p: string): string {
  return p.replace(/\\/g, "/").split("/").pop() ?? p;
}

function buildReason(
  contextReason: string,
  keywordScore: number,
  semanticScore: number,
  idea: IdeaRow
): string {
  const parts: string[] = [];
  if (contextReason)           parts.push(contextReason);
  if (keywordScore > 0.7)      parts.push("strong keyword match");
  else if (keywordScore > 0.3) parts.push("keyword match");
  if (semanticScore > 0.65)     parts.push("strong semantic match");
  else if (semanticScore >= 0.18) parts.push("semantic match");
  if (idea.status === "open")  parts.push("open thread");
  return parts.join("; ") || "recent capture";
}

export interface RecallOptions {
  query?: string;
  context?: RecallContext;
  limit?: number;
  queryEmbedding?: number[];
}

export async function recallIdeas(
  db: DatabaseSync,
  options: RecallOptions
): Promise<RecalledIdea[]> {
  const { context = {}, limit = 5 } = options;

  // Build query text: explicit query, or synthesise from context tokens
  const queryText =
    options.query ??
    ([context.file && basename(context.file), context.branch, context.repo && basename(context.repo)]
      .filter(Boolean)
      .join(" ") || null);

  // FTS5 search
  const ftsResults = queryText ? ftsSearch(db, queryText, limit * 4) : [];

  // Normalise BM25 ranks to [0,1]: position-based (rank values are negative)
  const ftsPositionMap = new Map(
    ftsResults.map((r, i) => [
      r.idea_id,
      // Top result = 1.0, linear decay to 0 at position limit*4
      Math.max(0, 1 - i / Math.max(ftsResults.length, 1)),
    ])
  );

  const semanticResults = options.queryEmbedding ? vectorSearch(db, options.queryEmbedding, limit * 4) : [];
  const semanticScoreMap = new Map(
    semanticResults
      .map((result) => [result.idea_id, Math.max(0, Math.min(1, 1 - result.distance))] as const)
      .filter(([, similarity]) => similarity >= 0.2)
  );

  // Collect candidate IDs: FTS hits first, then recent ideas as fallback
  const candidateIds = new Set<string>(ftsResults.map((r) => r.idea_id));
  semanticScoreMap.forEach((_score, id) => candidateIds.add(id));
  // An explicit search must not degrade into a list of unrelated recent
  // memories. Recent/context fallback is only appropriate for `recall recall`
  // without a query.
  if (candidateIds.size === 0 && !options.query?.trim()) {
    getRecentIdeas(db, limit * 2).forEach((r) =>
      candidateIds.add(r.id)
    );
  }

  if (candidateIds.size === 0) return [];

  const ideas = getIdeasByIds(db, [...candidateIds]).filter((idea) => {
    if (!options.query?.trim()) return true;
    if ((ftsPositionMap.get(idea.id) ?? 0) > 0) return true;
    const semanticScore = semanticScoreMap.get(idea.id) ?? 0;
    const sameRepo = Boolean(context.repo && idea.repo_path && norm(context.repo) === norm(idea.repo_path));
    const minimumSemanticScore = sameRepo ? 0.18 : context.repo ? 0.45 : 0.35;
    return semanticScore >= minimumSemanticScore;
  });

  const scored = ideas.map((idea) => {
    const ctx = contextScore(idea, context);
    const keywordScore = ftsPositionMap.get(idea.id) ?? 0;
    const semanticScore = semanticScoreMap.get(idea.id) ?? 0;
    const recency = recencyScore(idea.updated_at);
    const statusBonus = idea.status === "open" ? 1 : 0;

    const score =
      W_CONTEXT  * ctx.score +
      W_KEYWORD  * keywordScore +
      W_SEMANTIC * semanticScore +
      W_RECENCY  * recency +
      W_STATUS   * statusBonus;

    return {
      idea,
      score,
      contextReason: ctx.reason,
      keywordScore,
      semanticScore,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ idea, score, contextReason, keywordScore, semanticScore }) => ({
    idea: {
      ...idea,
      context: {
        idea_id: idea.id,
        repo_path: idea.repo_path,
        branch: idea.branch,
        file_path: idea.file_path,
        line_start: idea.line_start,
        line_end: idea.line_end,
        commit_hash: idea.commit_hash,
        error_text: idea.error_text,
      },
    },
    score,
    reason: buildReason(contextReason, keywordScore, semanticScore, idea),
  }));
}
