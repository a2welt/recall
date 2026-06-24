import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { insertIdea, resolveIdea } from "../src/db/index.js";
import { recallIdeas } from "../src/recall/index.js";
import { createTestDb, fakeEmbedding } from "./helpers.js";

let db: DatabaseSync;
beforeEach(() => { db = createTestDb(); });

describe("context match beats recency", () => {
  it("same-repo idea ranks above unrelated idea", async () => {
    insertIdea(db, {
      id: "old-repo",
      content: "Use read replicas for the reporting queries",
      source: "cli",
      embedding: fakeEmbedding(1),
      context: { repo_path: "/repos/myapp", branch: "main" },
    });
    insertIdea(db, {
      id: "new-unrelated",
      content: "Grocery list: milk, eggs, bread",
      source: "cli",
      embedding: fakeEmbedding(99),
      context: { repo_path: "/repos/unrelated", branch: "main" },
    });

    const results = await recallIdeas(db, {
      context: { repo: "/repos/myapp", branch: "main" },
      limit: 5,
    });
    const ids = results.map((r) => r.idea.id);
    expect(ids.indexOf("old-repo")).toBeLessThan(ids.indexOf("new-unrelated"));
  });

  it("same-file idea ranks above same-branch-only idea", async () => {
    insertIdea(db, {
      id: "same-file",
      content: "This function has O(n^2) complexity",
      source: "cli",
      embedding: fakeEmbedding(2),
      context: { repo_path: "/repos/myapp", branch: "feat/perf", file_path: "src/sort.ts" },
    });
    insertIdea(db, {
      id: "same-branch",
      content: "Performance work in progress",
      source: "cli",
      embedding: fakeEmbedding(3),
      context: { repo_path: "/repos/myapp", branch: "feat/perf" },
    });

    const results = await recallIdeas(db, {
      context: { repo: "/repos/myapp", branch: "feat/perf", file: "src/sort.ts" },
      limit: 5,
    });
    const ids = results.map((r) => r.idea.id);
    expect(ids.indexOf("same-file")).toBeLessThan(ids.indexOf("same-branch"));
  });
});

describe("status boost", () => {
  it("open ideas rank above resolved ideas", async () => {
    insertIdea(db, { id: "resolved", content: "Decide caching strategy", source: "cli", embedding: fakeEmbedding(5), context: { repo_path: "/repos/myapp" } });
    resolveIdea(db, "resolved");
    insertIdea(db, { id: "open", content: "Decide auth strategy", source: "cli", embedding: fakeEmbedding(6), context: { repo_path: "/repos/myapp" } });

    const results = await recallIdeas(db, { context: { repo: "/repos/myapp" }, limit: 5 });
    const ids = results.map((r) => r.idea.id);
    expect(ids.indexOf("open")).toBeLessThan(ids.indexOf("resolved"));
  });
});

describe("keyword search (FTS5)", () => {
  it("ranks keyword-matching idea first", async () => {
    insertIdea(db, {
      id: "relevant",
      content: "We chose event sourcing for the order service to enable audit logs.",
      source: "cli",
    });
    insertIdea(db, {
      id: "irrelevant",
      content: "The cat sat on the mat.",
      source: "cli",
    });

    const results = await recallIdeas(db, { query: "event sourcing orders", limit: 5 });
    expect(results[0].idea.id).toBe("relevant");
  });
  it("does not return unrelated recent memories for an unmatched explicit query", async () => {
    insertIdea(db, { id: "unrelated-query", content: "Team meeting on Tuesday", source: "cli", context: { repo_path: "/repos/myapp", branch: "main" } });
    const results = await recallIdeas(db, { query: "postgres database", context: { repo: "/repos/myapp", branch: "main" }, limit: 5 });
    expect(results).toEqual([]);
  });
  it("uses a semantic vector to match a differently worded decision", async () => {
    insertIdea(db, { id: "postgres-decision", content: "We selected PostgreSQL for JSONB indexes", source: "cli", embedding: [1, 0], context: { repo_path: "/repos/myapp", branch: "main" } });
    insertIdea(db, { id: "meeting-note", content: "Team meeting on Tuesday", source: "cli", embedding: [0, 1], context: { repo_path: "/repos/myapp", branch: "main" } });
    const results = await recallIdeas(db, { query: "database choice", queryEmbedding: [1, 0], context: { repo: "/repos/myapp", branch: "main" }, limit: 5 });
    expect(results.map((result) => result.idea.id)).toEqual(["postgres-decision"]);
    expect(results[0].reason).toContain("semantic match");
  });
});

describe("edge cases", () => {
  it("returns empty array for empty DB", async () => {
    expect(await recallIdeas(db, { limit: 5 })).toEqual([]);
  });
  it("each result has a reason string", async () => {
    insertIdea(db, { id: "r1", content: "Some idea", source: "cli", embedding: fakeEmbedding(7), context: { repo_path: "/repos/x" } });
    const results = await recallIdeas(db, { context: { repo: "/repos/x" }, limit: 1 });
    expect(typeof results[0].reason).toBe("string");
    expect(results[0].reason.length).toBeGreaterThan(0);
  });
});
