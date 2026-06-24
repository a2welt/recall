import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { ingestVault } from "../src/ingest/index.js";
import { listIdeas, getIngestedSourcePaths } from "../src/db/index.js";
import { createTestDb } from "./helpers.js";

let db: DatabaseSync;
let tmpVault: string;

beforeEach(() => {
  db = createTestDb();
  tmpVault = join(tmpdir(), `recall-test-${Date.now()}`);
  mkdirSync(tmpVault, { recursive: true });
});

afterEach(() => {
  rmSync(tmpVault, { recursive: true, force: true });
});

function writeNote(name: string, content: string): void {
  writeFileSync(join(tmpVault, name), content, "utf-8");
}

describe("ingestVault", () => {
  it("ingests markdown files", async () => {
    writeNote("note1.md", "# Decision\nWe chose PostgreSQL because of JSONB support.");
    writeNote("note2.md", "---\ntitle: Auth approach\n---\nUse JWT tokens.");
    const stats = await ingestVault({ vaultPath: tmpVault, db });
    expect(stats.added).toBe(2);
    expect(stats.skipped).toBe(0);
    expect(stats.errors).toBe(0);
    expect(listIdeas(db).length).toBe(2);
  });

  it("skips empty files", async () => {
    writeNote("empty.md", "   \n  ");
    const stats = await ingestVault({ vaultPath: tmpVault, db });
    expect(stats.added).toBe(0);
    expect(stats.skipped).toBe(1);
  });

  it("is incremental — skips unchanged files on re-ingest", async () => {
    writeNote("stable.md", "# Stable\nThis won't change.");
    const stats1 = await ingestVault({ vaultPath: tmpVault, db });
    expect(stats1.added).toBe(1);
    const stats2 = await ingestVault({ vaultPath: tmpVault, db });
    expect(stats2.skipped).toBe(1);
    expect(stats2.added).toBe(0);
  });

  it("extracts title from frontmatter", async () => {
    writeNote("fm.md", "---\ntitle: My Architecture Decision\n---\nContent here.");
    await ingestVault({ vaultPath: tmpVault, db });
    expect(listIdeas(db)[0].content).toContain("My Architecture Decision");
  });

  it("stores source_path for each ingested idea", async () => {
    writeNote("tracked.md", "# Track me");
    await ingestVault({ vaultPath: tmpVault, db });
    const paths = getIngestedSourcePaths(db);
    expect(paths.size).toBe(1);
    expect([...paths.keys()][0]).toContain("tracked.md");
  });

  it("handles non-existent vault path gracefully", async () => {
    const stats = await ingestVault({ vaultPath: "/nonexistent-path-xyz", db });
    expect(stats.added).toBe(0);
    expect(stats.errors).toBe(0);
  });
});
