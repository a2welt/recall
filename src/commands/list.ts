import { getDb, listIdeas } from "../db/index.js";
import { getGitContext } from "../git/index.js";
import type { IdeaRow } from "../db/index.js";

export interface ListOptions {
  repo?: boolean;
  open?: boolean;
}

function formatRow(idea: IdeaRow): string {
  const status = idea.status === "open" ? "○" : idea.status === "resolved" ? "✓" : "–";
  const date = idea.created_at.slice(0, 10);
  const preview = idea.content.slice(0, 80).replace(/\n/g, " ");
  const id = idea.id.slice(0, 8);
  const branch = idea.branch ? ` [${idea.branch}]` : "";
  return `${status} ${id}  ${date}${branch}  ${preview}`;
}

export async function listCommand(opts: ListOptions): Promise<void> {
  const db = getDb();

  let repoPath: string | undefined;
  if (opts.repo) {
    const gitCtx = await getGitContext();
    repoPath = gitCtx.repo_path ?? undefined;
    if (!repoPath) {
      console.error("Not in a git repo. Run without --repo to list all ideas.");
      process.exit(1);
    }
  }

  const ideas = listIdeas(db, { repo: repoPath, onlyOpen: opts.open });

  if (ideas.length === 0) {
    const scope = repoPath ? `in ${repoPath}` : "in store";
    console.log(`No ideas ${scope}${opts.open ? " (open)" : ""}.`);
    return;
  }

  console.log(`${ideas.length} idea(s):\n`);
  ideas.forEach((idea) => console.log(formatRow(idea)));
}
