import { describe, expect, it } from "vitest";
import { createZip } from "../src/ai/zip.js";

describe("handoff ZIP", () => {
  it("contains local and central ZIP records for every artifact", () => { const zip = createZip({ "SPEC.md": "# Specification", "manifest.json": "{}" }); expect(zip.readUInt32LE(0)).toBe(0x04034b50); expect(zip.includes(Buffer.from("SPEC.md"))).toBe(true); expect(zip.includes(Buffer.from("manifest.json"))).toBe(true); expect(zip.includes(Buffer.from("# Specification"))).toBe(true); expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50); });
});
