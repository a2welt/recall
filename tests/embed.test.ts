/**
 * Embedding engine tests.
 *
 * NOTE: The embedding pipeline (onnxruntime-node / Transformers.js) is optional
 * and not required for core Recall functionality (FTS5 handles search).
 * These tests are skipped by default to avoid requiring onnxruntime to be installed.
 * To run them: RECALL_TEST_EMBED=1 npx vitest run tests/embed.test.ts
 */
import { describe, it, expect } from "vitest";
import { EMBED_DIM } from "../src/embed/index.js";

const RUN_EMBED = process.env.RECALL_TEST_EMBED === "1";

describe("embed module exports", () => {
  it("exports EMBED_DIM constant", () => {
    expect(EMBED_DIM).toBe(384);
  });

  it.skipIf(!RUN_EMBED)("embed() returns a unit vector of correct dimension", async () => {
    const { embed } = await import("../src/embed/index.js");
    const v = await embed("hello world");
    expect(v.length).toBe(EMBED_DIM);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 2);
  });

  it.skipIf(!RUN_EMBED)("similar texts produce higher cosine similarity than dissimilar", async () => {
    const { embed } = await import("../src/embed/index.js");
    const [vA, vB, vC] = await Promise.all([
      embed("The database uses event sourcing"),
      embed("Event sourcing pattern for the DB"),
      embed("The cat sat on the mat"),
    ]);
    const cosine = (a: number[], b: number[]): number =>
      a.reduce((s, ai, i) => s + ai * b[i], 0);
    expect(cosine(vA, vB)).toBeGreaterThan(cosine(vA, vC));
  });

  it.skipIf(!RUN_EMBED)("embedBatch embeds multiple texts", async () => {
    const { embedBatch } = await import("../src/embed/index.js");
    const results = await embedBatch(["first", "second", "third"]);
    expect(results.length).toBe(3);
    results.forEach((v) => expect(v.length).toBe(EMBED_DIM));
  });
});
