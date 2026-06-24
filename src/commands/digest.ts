/**
 * `recall digest` — a "here's what you were chewing on" view.
 *
 * Shows:
 *  - Recent captures (last 7 days) for the current repo
 *  - Resurfaced ideas relevant to the current context
 */

import { getDb, getRecentIdeas } from "../db/index.js";
import { getGitContext } from "../git/index.js";
import { recallIdeas } from "../recall/index.js";
import type { IdeaRow } from "../db/index.js";
import type { RecalledIdea } from "../types.js";

function fmtIdea(idea: IdeaRow): string {
  const date = idea.created_at.slice(0, 10);
  const preview = idea.content.slice(0, 100).replace(/\n/g, " ");
  const id = idea.id.slice(0, 8);
  return `  [${id}] ${date}  ${preview}`;
}

function fmtRecalled(r: RecalledIdea, i: number): string {
  const preview = r.idea.content.slice(0, 100).replace(/\n/g, " ");
  const id = r.idea.id.slice(0, 8);
  return `  ${i + 1}. [${id}] ${preview}\n     → ${r.reason}`;
}

export async function digestCommand(): Promise<void> {
  const db = getDb();
  const gitCtx = await getGitContext();

  const repoLabel = gitCtx.repo_path
    ? gitCtx.repo_path.split(/[/\\]/).pop()
    : null;

  console.log(
    `\n━━ Recall Digest${repoLabel ? ` · ${repoLabel}` : ""} ━━\n`
  );

  // ── Recent captures ────────────────────────────────────────────────────────
  const recent = getRecentIdeas(
    db,
    10,
    gitCtx.repo_path ?? undefined
  );

  // Filter to last 7 days
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thisWeek = recent.filter((r) => r.created_at >= cutoff);

  if (thisWeek.length > 0) {
    console.log(`Recent (last 7 days, ${thisWeek.length}):`);
    thisWeek.forEach((r) => console.log(fmtIdea(r)));
  } else {
    console.log("No captures in the last 7 days.");
  }

  // ── Resurfaced ─────────────────────────────────────────────────────────────
  console.log("\nResurfaced for current context:");

  const resurfaced = await recallIdeas(db, {
    context: {
      repo: gitCtx.repo_path ?? undefined,
      branch: gitCtx.branch ?? undefined,
    },
    limit: 5,
  });

  if (resurfaced.length === 0) {
    console.log("  (nothing surfaced yet — try `recall add` or `recall ingest`)");
  } else {
    resurfaced.forEach((r, i) => console.log(fmtRecalled(r, i)));
  }

  console.log("");
}
