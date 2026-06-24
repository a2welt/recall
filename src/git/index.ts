import { simpleGit } from "simple-git";
import type { GitContext } from "../types.js";

/**
 * Attempt to detect the Git context for the given directory.
 * Returns null values for each field when not in a git repo.
 */
export async function getGitContext(cwd?: string): Promise<GitContext> {
  const dir = cwd ?? process.cwd();

  try {
    const git = simpleGit({ baseDir: dir, binary: "git" });

    const isRepo = await git
      .checkIsRepo()
      .catch(() => false);
    if (!isRepo) return nullContext();

    const [topLevel, showCurrent, abbrevRef, log] = await Promise.all([
      git.revparse(["--show-toplevel"]).catch(() => null),
      // `branch --show-current` reports the branch even on an unborn branch
      // (a repo with no commits yet), where `rev-parse --abbrev-ref HEAD` fails.
      // It returns "" on a detached HEAD, in which case there is no branch.
      git.raw(["branch", "--show-current"]).catch(() => null),
      git.revparse(["--abbrev-ref", "HEAD"]).catch(() => null),
      git.log(["-1", "--format=%H"]).catch(() => null),
    ]);

    const current = showCurrent?.trim();
    const abbrev = abbrevRef?.trim();
    const branch = current || (abbrev && abbrev !== "HEAD" ? abbrev : null) || null;

    return {
      repo_path: topLevel?.trim() ?? null,
      branch,
      commit_hash: log?.latest?.hash ?? null,
    };
  } catch {
    return nullContext();
  }
}

function nullContext(): GitContext {
  return { repo_path: null, branch: null, commit_hash: null };
}
