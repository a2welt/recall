import { v4 as uuidv4 } from "uuid";
import { getDb, insertIdea } from "../db/index.js";
import { getGitContext } from "../git/index.js";

export interface AddOptions {
  file?: string;
  repo?: string;
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
