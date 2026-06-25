import { v4 as uuidv4 } from "uuid";
import { getDb, insertIdea } from "../db/index.js";
import { getGitContext } from "../git/index.js";
import type { DecisionMetadata } from "../types.js";

export interface AddOptions {
  file?: string;
  repo?: string;
  decision?: string;
  why?: string;
  alternative?: string[];
  tradeoff?: string[];
  evidence?: string;
  outcome?: string;
}

export async function addIdea(content: string, opts: AddOptions): Promise<void> {
  if (!content.trim()) {
    console.error("Error: content cannot be empty.");
    process.exit(1);
  }

  const db = getDb();

  // Auto-detect git context from cwd (or --repo override)
  const gitCtx = await getGitContext(opts.repo ?? process.cwd());

  const id = uuidv4();

  insertIdea(db, {
    id,
    content,
    source: "cli",
    decision: buildDecisionMetadata(opts),
    context: {
      repo_path: gitCtx.repo_path,
      branch: gitCtx.branch,
      commit_hash: gitCtx.commit_hash,
      file_path: opts.file ?? null,
    },
  });

  console.log(`✓ Captured idea ${id}`);
  if (gitCtx.repo_path) console.log(`  repo:   ${gitCtx.repo_path}`);
  if (gitCtx.branch) console.log(`  branch: ${gitCtx.branch}`);
  if (opts.file) console.log(`  file:   ${opts.file}`);

  // Make a missing repo context obvious rather than silently saving a
  // context-less memory — the most common cause is running outside a repo.
  if (!gitCtx.repo_path) {
    console.log("  ⚠ no git repository detected — saved without repo/branch context.");
    console.log(`    Run 'recall add' from inside a git repo, or pass --repo <path>.`);
  } else if (!gitCtx.branch) {
    console.log("  ⚠ repository detected but no branch (unborn branch or detached HEAD).");
  }
}

function joinMulti(values: string[] | string | undefined): string | undefined {
  if (!values) return undefined;
  return Array.isArray(values) ? values.filter(Boolean).join("\n") : values;
}

function buildDecisionMetadata(opts: AddOptions): DecisionMetadata {
  return {
    decision: opts.decision,
    why: opts.why,
    alternatives: joinMulti(opts.alternative),
    tradeoffs: joinMulti(opts.tradeoff),
    evidence: opts.evidence,
    outcome: opts.outcome,
  };
}
