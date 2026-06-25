import { getDb } from "../db/index.js";
import { getGitContext } from "../git/index.js";
import { recallIdeas } from "../recall/index.js";
import type { RecalledIdea } from "../types.js";
import { prepareSemanticQuery } from "../embed/semantic.js";

export interface RecallOptions {
  limit?: number;
}

function formatIdea(r: RecalledIdea, index: number): string {
  const lines: string[] = [];
  const { idea, reason } = r;

  lines.push(`\n[${index + 1}] ${idea.content.slice(0, 200)}`);
  if (idea.content.length > 200) lines.push("    …");
  if (idea.decision) lines.push(`    decision: ${idea.decision}`);
  if (idea.why) lines.push(`    rationale: ${idea.why}`);
  if (idea.alternatives) lines.push(`    rejected: ${idea.alternatives}`);

  const meta: string[] = [];
  if (idea.context?.repo_path) meta.push(`repo: ${idea.context.repo_path}`);
  if (idea.context?.branch) meta.push(`branch: ${idea.context.branch}`);
  if (idea.context?.file_path) meta.push(`file: ${idea.context.file_path}`);
  if (idea.status === "open") meta.push("open");
  meta.push(`id: ${idea.id.slice(0, 8)}`);

  lines.push(`    surfaced: ${reason}`);
  lines.push(`    ${meta.join(" · ")}`);
  return lines.join("\n");
}

export async function recallCommand(
  query: string | undefined,
  opts: RecallOptions
): Promise<void> {
  const db = getDb();
  const limit = opts.limit ?? 5;

  // Detect current git context to boost context-matched ideas
  const gitCtx = await getGitContext();
  let queryEmbedding: number[] | undefined;
  if (query?.trim()) {
    let announced = false;
    try {
      queryEmbedding = await prepareSemanticQuery(db, query, (completed, total) => {
        if (!announced) { console.log(`Preparing local semantic index for ${total} memories…`); announced = true; }
        if (completed === total) console.log("Semantic index ready.");
      });
    } catch (error) {
      console.error(`Semantic search unavailable; using keywords only: ${(error as Error).message}`);
    }
  }

  const results = await recallIdeas(db, {
    query,
    context: {
      repo: gitCtx.repo_path ?? undefined,
      branch: gitCtx.branch ?? undefined,
    },
    limit,
    queryEmbedding,
  });

  if (results.length === 0) {
    console.log("No ideas found. Try `recall add` to capture something first.");
    return;
  }

  const context = [gitCtx.branch, gitCtx.repo_path].filter(Boolean).join(" · ");
  console.log(`Recalling${query ? ` for "${query}"` : ""} (context: ${context || "none"})`);
  results.forEach((r, i) => console.log(formatIdea(r, i)));
}
