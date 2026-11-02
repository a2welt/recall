import { describe, it, expect, beforeEach } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import {
  addIdeaLink, backfillEvidenceLinks, deleteIdea, findLinksByReference, insertIdea, InvalidLinkError,
  listAllLinks, listIdeaLinks, removeIdeaLink, resolveIdeaId, runMigrations, setDb,
} from "../src/db/index.js";
import { handleRecallLink } from "../src/mcp/server.js";
import { createTestDb } from "./helpers.js";

const DIGEST = "ab".repeat(32);
const COMMIT = "c".repeat(40);
const FILE = `git+https://github.com/findajay/Open-model-fabric@${COMMIT}#python/omf/core/services/routing.py`;
const RECEIPT = `agentproof:sha256:${DIGEST}`;

let db: DatabaseSync;
beforeEach(() => {
  db = createTestDb();
  setDb(db);
  insertIdea(db, { id: "m1", content: "Route by cost", source: "cli", category: "decision", decision: { decision: "Prefer the cheapest model that passes evals" } });
  insertIdea(db, { id: "m2", content: "Cache embeddings", source: "mcp" });
});

describe("idea_links schema", () => {
  it("rejects unknown relations at the database level", () => {
    expect(() => db.prepare(`INSERT INTO idea_links (memory_id, reference, relation) VALUES ('m1', ?, 'mentions')`).run(RECEIPT)).toThrow();
  });

  it("is unique on memory, reference, and relation", () => {
    expect(addIdeaLink(db, "m1", RECEIPT, "explains")!.created).toBe(true);
    expect(addIdeaLink(db, "m1", RECEIPT, "explains")!.created).toBe(false);
    expect(addIdeaLink(db, "m1", RECEIPT, "changed-by")!.created).toBe(true);
    expect(listIdeaLinks(db, "m1")).toHaveLength(2);
  });

  it("drops links when the memory is deleted", () => {
    addIdeaLink(db, "m1", RECEIPT);
    deleteIdea(db, "m1");
    expect(listAllLinks(db)).toHaveLength(0);
  });
});

describe("addIdeaLink / removeIdeaLink", () => {
  it("defaults to related and returns the stored link", () => {
    const { link } = addIdeaLink(db, "m1", `  ${RECEIPT} `)!;
    expect(link).toMatchObject({ memory_id: "m1", reference: RECEIPT, relation: "related" });
    expect(link.created_at).toBeTruthy();
  });

  it("returns undefined for an unknown memory", () => {
    expect(addIdeaLink(db, "nope", RECEIPT)).toBeUndefined();
  });

  it("rejects invalid references, relations, and self-links", () => {
    expect(() => addIdeaLink(db, "m1", "agentproof:sha256:short")).toThrow(InvalidLinkError);
    expect(() => addIdeaLink(db, "m1", RECEIPT, "mentions" as never)).toThrow(/relation must be one of/);
    expect(() => addIdeaLink(db, "m1", "recall:memory:m1")).toThrow(/itself/);
  });

  it("keeps opaque references verbatim", () => {
    expect(addIdeaLink(db, "m1", "jira:ENG-42")!.link.reference).toBe("jira:ENG-42");
  });

  it("removes one relation or every relation to a reference", () => {
    addIdeaLink(db, "m1", RECEIPT, "explains");
    addIdeaLink(db, "m1", RECEIPT, "changed-by");
    addIdeaLink(db, "m1", FILE, "constrains");
    expect(removeIdeaLink(db, "m1", RECEIPT, "explains")).toBe(1);
    expect(removeIdeaLink(db, "m1", RECEIPT)).toBe(1);
    expect(removeIdeaLink(db, "m1", RECEIPT)).toBe(0);
    expect(listIdeaLinks(db, "m1").map((link) => link.reference)).toEqual([FILE]);
  });
});

describe("findLinksByReference", () => {
  beforeEach(() => {
    addIdeaLink(db, "m1", `${FILE}:L40-L72`, "constrains");
    addIdeaLink(db, "m2", FILE, "explains");
    addIdeaLink(db, "m2", `${FILE}.bak:L1-L2`, "related");
    addIdeaLink(db, "m2", `git+https://github.com/findajay/Open-model-fabric@${COMMIT}#python/omf/core/services/routing.pyc`, "related");
    addIdeaLink(db, "m1", RECEIPT, "changed-by");
  });

  it("matches a file reference against every line range of that file only", () => {
    const search = findLinksByReference(db, FILE);
    expect(search.match).toBe("path");
    expect(search.links.map((link) => [link.memory_id, link.reference]).sort()).toEqual([
      ["m1", `${FILE}:L40-L72`],
      ["m2", FILE],
    ]);
  });

  it("matches a ranged reference exactly", () => {
    const search = findLinksByReference(db, `${FILE}:L40-L72`);
    expect(search.match).toBe("exact");
    expect(search.links).toHaveLength(1);
    expect(search.links[0].memory).toMatchObject({ id: "m1", decision: "Prefer the cheapest model that passes evals", category: "decision", status: "open" });
  });

  it("filters by relation and finds receipts", () => {
    expect(findLinksByReference(db, FILE, "constrains").links.map((link) => link.memory_id)).toEqual(["m1"]);
    expect(findLinksByReference(db, RECEIPT).links.map((link) => link.relation)).toEqual(["changed-by"]);
  });

  it("rejects an invalid reference", () => {
    expect(() => findLinksByReference(db, "not a reference")).toThrow(InvalidLinkError);
  });
});

describe("evidence references", () => {
  it("become related links when a memory is captured", () => {
    insertIdea(db, {
      id: "m3", content: "Switch routing to cost-first", source: "mcp",
      decision: { evidence: `Load test in staging.\n${RECEIPT}\n${FILE}:L40-L72\nrecall:memory:m1\nrecall:memory:m3` },
    });
    expect(listIdeaLinks(db, "m3").map((link) => [link.reference, link.relation]).sort()).toEqual([
      [RECEIPT, "related"],
      [`${FILE}:L40-L72`, "related"],
      ["recall:memory:m1", "related"],
    ]);
  });

  it("are backfilled once when an existing database is migrated", () => {
    const old = createTestDb({ links: false });
    old.prepare(`INSERT INTO ideas (id, content, source) VALUES ('old', 'Pin numpy', 'cli')`).run();
    old.prepare(`INSERT INTO idea_decisions (idea_id, evidence) VALUES ('old', ?)`).run(`CI broke on 2.0\n${RECEIPT}\nomf:request:req-9`);
    old.prepare(`INSERT INTO ideas (id, content, source) VALUES ('plain', 'No evidence', 'cli')`).run();

    runMigrations(old);
    expect(listIdeaLinks(old, "old").map((link) => link.reference).sort()).toEqual(["omf:request:req-9", RECEIPT].sort());

    // A link the user removed is not re-created by the next start.
    removeIdeaLink(old, "old", RECEIPT);
    runMigrations(old);
    expect(listIdeaLinks(old, "old").map((link) => link.reference)).toEqual(["omf:request:req-9"]);

    // Running the backfill explicitly is idempotent.
    expect(backfillEvidenceLinks(old)).toBe(1);
    expect(backfillEvidenceLinks(old)).toBe(0);
  });
});

describe("resolveIdeaId", () => {
  it("resolves full ids and unique prefixes only", () => {
    expect(resolveIdeaId(db, "m1")).toBe("m1");
    expect(resolveIdeaId(db, "m")).toBeUndefined(); // ambiguous
    expect(resolveIdeaId(db, "x")).toBeUndefined();
  });
});

describe("recall_link MCP tool", () => {
  it("adds, lists, finds, and removes links", async () => {
    const added = JSON.parse(await handleRecallLink({ memory_id: "m1", reference: FILE, relation: "constrains" }));
    expect(added).toMatchObject({ memory_id: "m1", reference: FILE, relation: "constrains", created: true });

    const listed = JSON.parse(await handleRecallLink({ action: "list", memory_id: "m1" }));
    expect(listed.links).toHaveLength(1);

    const found = JSON.parse(await handleRecallLink({ action: "find", reference: FILE }));
    expect(found.links.map((link: { memory_id: string }) => link.memory_id)).toEqual(["m1"]);

    const removed = JSON.parse(await handleRecallLink({ action: "remove", memory_id: "m1", reference: FILE }));
    expect(removed.removed).toBe(1);
  });

  it("reports errors as JSON", async () => {
    expect(JSON.parse(await handleRecallLink({ memory_id: "nope", reference: FILE })).error).toMatch(/not found/);
    expect(JSON.parse(await handleRecallLink({ memory_id: "m1", reference: FILE, relation: "mentions" })).error).toMatch(/relation/);
    expect(JSON.parse(await handleRecallLink({ action: "find" })).error).toMatch(/reference/);
    expect(JSON.parse(await handleRecallLink({ action: "explode", memory_id: "m1" })).error).toMatch(/Unknown action/);
    await expect(handleRecallLink({ memory_id: "m1", reference: "bad ref" })).rejects.toThrow(InvalidLinkError);
  });
});
