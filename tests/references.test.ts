import { describe, it, expect } from "vitest";
import { extractEvidenceReferences, InvalidReferenceError, isValidReference, parseReference } from "../src/links/references.js";

const DIGEST = "46ab4a67".padEnd(64, "0");
const COMMIT = "cea75b0".padEnd(40, "1");
const CODE = `git+https://github.com/findajay/Open-model-fabric@${COMMIT}#python/omf/core/services/routing.py`;

describe("parseReference", () => {
  it("accepts every shared reference kind", () => {
    expect(parseReference(`agentproof:sha256:${DIGEST}`).kind).toBe("receipt");
    expect(parseReference("recall:memory:3f0c9d2e-8b1a-4c5e-9a77-2d4e6f1b0c13").kind).toBe("memory");
    expect(parseReference(CODE).kind).toBe("code");
    expect(parseReference(`${CODE}:L40-L72`).kind).toBe("code");
    expect(parseReference("omf:request:req-123").kind).toBe("model-call");
    expect(parseReference("ballast:request:abc").kind).toBe("model-call");
    expect(parseReference("ballast://source/knowledge:kb-7").kind).toBe("knowledge");
  });

  it("splits a code reference into its path reference and line range", () => {
    const ranged = parseReference(`${CODE}:L40-L72`);
    expect(ranged.path_reference).toBe(CODE);
    expect(ranged.has_line_range).toBe(true);
    const whole = parseReference(CODE);
    expect(whole.path_reference).toBe(CODE);
    expect(whole.has_line_range).toBe(false);
  });

  it("keeps an @ inside the repository URL", () => {
    const ref = `git+ssh://git@github.com/a2welt/recall@${COMMIT}#src/db/index.ts:L1-L1`;
    expect(parseReference(ref).path_reference).toBe(`git+ssh://git@github.com/a2welt/recall@${COMMIT}#src/db/index.ts`);
  });

  it("keeps unknown lowercase schemes as opaque strings", () => {
    expect(parseReference("https://github.com/a2welt/recall/pull/2")).toEqual({ reference: "https://github.com/a2welt/recall/pull/2", kind: "opaque" });
    expect(parseReference("jira:ENG-42").kind).toBe("opaque");
  });

  it("trims surrounding whitespace", () => {
    expect(parseReference(`  omf:request:r1\n`).reference).toBe("omf:request:r1");
  });

  it.each([
    ["", "required"],
    ["no scheme here", "whitespace"],
    ["plain-text", "URI"],
    ["jira:", "URI"],
    ["Jira:ENG-42", "lowercase"],
    ["agentproof:sha256:abc", "agentproof"],
    [`agentproof:sha256:${DIGEST.toUpperCase()}`, "agentproof"],
    [`agentproof:${DIGEST}`, "agentproof"],
    ["recall:memory:", "recall:memory"],
    ["recall:idea:123", "recall:memory"],
    [`git+https://github.com/a/b@abc123#src/x.ts`, "40-hex"],
    [`git+https://github.com/a/b@${COMMIT}`, "40-hex"],
    [`git+https://github.com/a/b@${COMMIT}#`, "40-hex"],
    [`${CODE}:L72-L40`, "start <= end"],
    [`${CODE}:L0-L3`, "start <= end"],
    [`${CODE}:L40`, "line range"],
    ["ballast://source/other:1", "ballast"],
    ["omf:request:has space", "whitespace"],
  ])("rejects %j", (input, message) => {
    expect(() => parseReference(input)).toThrow(InvalidReferenceError);
    expect(() => parseReference(input)).toThrow(new RegExp(message.replace(/[+]/g, "\\+"), "i"));
  });

  it("rejects overly long references", () => {
    expect(isValidReference(`jira:${"x".repeat(2100)}`)).toBe(false);
  });
});

describe("extractEvidenceReferences", () => {
  it("takes known references on their own lines, after free text", () => {
    const evidence = [
      "Benchmarked both routers; see PR discussion.",
      `agentproof:sha256:${DIGEST}`,
      `  ${CODE}:L40-L72  `,
      "omf:request:req-123",
      "todo:later",
      "https://example.com/not-a-shared-reference",
      `inline agentproof:sha256:${DIGEST} does not count`,
      `agentproof:sha256:${DIGEST}`,
    ].join("\r\n");
    expect(extractEvidenceReferences(evidence)).toEqual([
      `agentproof:sha256:${DIGEST}`,
      `${CODE}:L40-L72`,
      "omf:request:req-123",
    ]);
  });

  it("returns nothing for empty evidence", () => {
    expect(extractEvidenceReferences(null)).toEqual([]);
    expect(extractEvidenceReferences("Prototype query plan")).toEqual([]);
  });
});
