import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { setDb, insertIdea, resolveIdea, listIdeas } from "../src/db/index.js";
import { recallIdeas } from "../src/recall/index.js";
import { resolveCaptureContext } from "../src/mcp/server.js";
import { createTestDb, fakeEmbedding } from "./helpers.js";
import { v4 as uuidv4 } from "uuid";

let db: DatabaseSync;
beforeEach(() => { db = createTestDb(); setDb(db); });

describe("capture_idea", () => {
  it("stores an MCP-sourced idea", () => {
    const id = uuidv4();
    insertIdea(db, { id, content: "Prefer optimistic locking for cart", source: "mcp", embedding: fakeEmbedding(20), context: { repo_path: "/repos/shop", branch: "feat/cart" } });
    const ideas = listIdeas(db);
    expect(ideas.length).toBe(1);
    expect(ideas[0].source).toBe("mcp");
  });
});

describe("resolveCaptureContext (git auto-detect)", () => {
  const detected = { repo_path: "/repos/api", branch: "main", commit_hash: "abc123" };

  it("fills repo, branch, and commit from the cwd when the agent omits context", () => {
    const ctx = resolveCaptureContext({}, detected);
    expect(ctx.repo_path).toBe("/repos/api");
    expect(ctx.branch).toBe("main");
    expect(ctx.commit_hash).toBe("abc123");
  });

  it("lets agent-supplied values win over detection", () => {
    const ctx = resolveCaptureContext({ repo: "/repos/api", branch: "feat/x" }, detected);
    expect(ctx.repo_path).toBe("/repos/api");
    expect(ctx.branch).toBe("feat/x");
    expect(ctx.commit_hash).toBe("abc123"); // same repo, so commit still attaches
  });

  it("does not borrow branch or commit when the agent names a different repo", () => {
    const ctx = resolveCaptureContext({ repo: "/repos/other" }, detected);
    expect(ctx.repo_path).toBe("/repos/other");
    expect(ctx.branch).toBeNull();
    expect(ctx.commit_hash).toBeNull();
  });

  it("matches repo paths across separators and trailing slashes", () => {
    const ctx = resolveCaptureContext({ repo: "\\repos\\api\\" }, { repo_path: "/repos/api", branch: "dev", commit_hash: "z9" });
    expect(ctx.branch).toBe("dev");
    expect(ctx.commit_hash).toBe("z9");
  });

  it("preserves file and error fields, leaving nulls when no git is present", () => {
    const ctx = resolveCaptureContext({ file: "src/x.ts", error: "boom" }, { repo_path: null, branch: null, commit_hash: null });
    expect(ctx.file_path).toBe("src/x.ts");
    expect(ctx.error_text).toBe("boom");
    expect(ctx.repo_path).toBeNull();
    expect(ctx.branch).toBeNull();
  });
});

describe("recall_ideas", () => {
  it("surfaces context-matched MCP ideas", async () => {
    const id = uuidv4();
    insertIdea(db, { id, content: "Use Redis for session caching", source: "mcp", embedding: fakeEmbedding(30), context: { repo_path: "/repos/api", branch: "main" } });
    const results = await recallIdeas(db, { context: { repo: "/repos/api", branch: "main" }, limit: 3 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].idea.id).toBe(id);
  });
});

describe("list_open_ideas", () => {
  it("returns only open ideas", () => {
    const id1 = uuidv4();
    const id2 = uuidv4();
    insertIdea(db, { id: id1, content: "Open idea",     source: "mcp", embedding: fakeEmbedding(40) });
    insertIdea(db, { id: id2, content: "Resolved idea", source: "mcp", embedding: fakeEmbedding(41) });
    resolveIdea(db, id2);
    const open = listIdeas(db, { onlyOpen: true });
    expect(open.length).toBe(1);
    expect(open[0].id).toBe(id1);
  });

  it("scopes to a specific repo", () => {
    insertIdea(db, { id: uuidv4(), content: "API idea", source: "mcp", embedding: fakeEmbedding(50), context: { repo_path: "/repos/api" } });
    insertIdea(db, { id: uuidv4(), content: "UI idea",  source: "mcp", embedding: fakeEmbedding(51), context: { repo_path: "/repos/ui" } });
    expect(listIdeas(db, { repo: "/repos/api" }).length).toBe(1);
  });
});

describe("resolve_idea", () => {
  it("marks an MCP idea as resolved", () => {
    const id = uuidv4();
    insertIdea(db, { id, content: "Decide DB engine", source: "mcp", embedding: fakeEmbedding(60) });
    expect(resolveIdea(db, id)).toBe(true);
    expect(listIdeas(db, { onlyOpen: true }).length).toBe(0);
  });
  it("returns false for unknown id", () => {
    expect(resolveIdea(db, "does-not-exist")).toBe(false);
  });
});
