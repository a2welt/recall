import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  insertIdea, resolveIdea, listIdeas, getIdeaById,
  vectorSearch, getIngestedSourcePaths,
} from "../src/db/index.js";
import { createTestDb, fakeEmbedding } from "./helpers.js";

let db: DatabaseSync;
beforeEach(() => { db = createTestDb(); });

describe("insertIdea", () => {
  it("stores an idea with context and embedding", () => {
    insertIdea(db, {
      id: "idea-1",
      content: "Use event sourcing for the order service",
      source: "cli",
      embedding: fakeEmbedding(1),
      context: { repo_path: "/repos/myapp", branch: "feat/orders", commit_hash: "abc123" },
    });
    const row = getIdeaById(db, "idea-1");
    expect(row).toBeDefined();
    expect(row!.content).toBe("Use event sourcing for the order service");
    expect(row!.source).toBe("cli");
    expect(row!.status).toBe("open");
    expect(row!.repo_path).toBe("/repos/myapp");
    expect(row!.branch).toBe("feat/orders");
  });

  it("stores an ingested idea with source_path", () => {
    insertIdea(db, {
      id: "idea-2",
      content: "Note from vault",
      source: "ingested",
      source_path: "/vault/note.md",
      embedding: fakeEmbedding(2),
      context: { file_path: "note.md" },
    });
    expect(getIngestedSourcePaths(db).has("/vault/note.md")).toBe(true);
  });

  it("stores null context fields gracefully", () => {
    insertIdea(db, { id: "idea-3", content: "Outside git", source: "cli", embedding: fakeEmbedding(3) });
    const row = getIdeaById(db, "idea-3");
    expect(row!.repo_path).toBeNull();
    expect(row!.branch).toBeNull();
  });
});

describe("resolveIdea", () => {
  it("marks an idea as resolved", () => {
    insertIdea(db, { id: "idea-4", content: "Decide on DB", source: "cli", embedding: fakeEmbedding(4) });
    expect(resolveIdea(db, "idea-4")).toBe(true);
    expect(getIdeaById(db, "idea-4")!.status).toBe("resolved");
  });
  it("returns false for unknown id", () => {
    expect(resolveIdea(db, "nonexistent")).toBe(false);
  });
});

describe("listIdeas", () => {
  beforeEach(() => {
    insertIdea(db, { id: "a", content: "Alpha", source: "cli", embedding: fakeEmbedding(10), context: { repo_path: "/repos/alpha", branch: "main" } });
    insertIdea(db, { id: "b", content: "Beta",  source: "cli", embedding: fakeEmbedding(11), context: { repo_path: "/repos/beta",  branch: "main" } });
    resolveIdea(db, "b");
  });
  it("lists all ideas", () => expect(listIdeas(db).length).toBe(2));
  it("filters by repo", () => {
    const ideas = listIdeas(db, { repo: "/repos/alpha" });
    expect(ideas.length).toBe(1);
    expect(ideas[0].content).toBe("Alpha");
  });
  it("filters open only", () => {
    const ideas = listIdeas(db, { onlyOpen: true });
    expect(ideas.length).toBe(1);
    expect(ideas[0].id).toBe("a");
  });
});

describe("vectorSearch", () => {
  it("returns closest embedding by distance", () => {
    const embA = fakeEmbedding(100);
    const embB = fakeEmbedding(200);
    const embC = fakeEmbedding(100); // same as A

    insertIdea(db, { id: "va", content: "A", source: "cli", embedding: embA });
    insertIdea(db, { id: "vb", content: "B", source: "cli", embedding: embB });
    insertIdea(db, { id: "vc", content: "C", source: "cli", embedding: embC });

    const results = vectorSearch(db, embA, 3);
    expect(results[0].idea_id).toMatch(/v[ac]/);
    expect(results[0].distance).toBeLessThan(0.01);
    expect(results[results.length - 1].idea_id).toBe("vb");
  });
  it("returns empty for empty db", () => {
    expect(vectorSearch(db, fakeEmbedding(1), 5).length).toBe(0);
  });
});
