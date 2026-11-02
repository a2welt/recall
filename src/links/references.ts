/**
 * Shared reference URIs — the strings tools in the Open Engineering Studio use to
 * point at each other's objects (see open-agent-trust docs/integration/shared-references.md).
 *
 *   agentproof:sha256:<64 hex>                            receipt, by digest
 *   recall:memory:<id>                                    Recall memory
 *   git+<url>@<40-hex commit>#<path>[:L<a>-L<b>]          code at a pinned commit
 *   <gateway>:request:<id>                                model call
 *   ballast://source/knowledge:<id>                       BallastOS knowledge item
 *
 * Known schemes are validated. Any other lowercase scheme is kept as an opaque
 * string: tools compare references as plain strings, so Recall stores them verbatim.
 */

export type ReferenceKind = "receipt" | "memory" | "code" | "model-call" | "knowledge" | "opaque";

export interface ParsedReference {
  reference: string;
  kind: ReferenceKind;
  /** For `code`: the reference without its line range, i.e. `git+<url>@<commit>#<path>`. */
  path_reference?: string;
  /** For `code`: whether the reference carries a `:L<a>-L<b>` line range. */
  has_line_range?: boolean;
}

export class InvalidReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReferenceError";
  }
}

const MAX_REFERENCE_LENGTH = 2048;

const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;
const RECEIPT = /^agentproof:sha256:[0-9a-f]{64}$/;
const MEMORY = /^recall:memory:[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODEL_CALL = /^[a-z][a-z0-9.-]*:request:[^\s]+$/;
const KNOWLEDGE = /^ballast:\/\/source\/knowledge:[^\s]+$/;
// Greedy URL so an `@` inside it (ssh user) is kept; the commit is the last `@<40 hex>#`.
const CODE = /^git\+([a-z][a-z0-9+.-]*:\/\/[^\s#]+)@([0-9a-f]{40})#([^\s]+)$/;
const LINE_RANGE = /:L(\d+)-L(\d+)$/;

/** Validate a reference URI. Throws InvalidReferenceError when it is malformed. */
export function parseReference(input: string): ParsedReference {
  const reference = typeof input === "string" ? input.trim() : "";
  if (!reference) throw new InvalidReferenceError("reference is required");
  if (reference.length > MAX_REFERENCE_LENGTH) throw new InvalidReferenceError(`reference is longer than ${MAX_REFERENCE_LENGTH} characters`);
  if (/\s/.test(reference)) throw new InvalidReferenceError("reference must not contain whitespace");

  const schemeMatch = reference.match(SCHEME);
  if (!schemeMatch || reference.length === schemeMatch[0].length) {
    throw new InvalidReferenceError("reference must be a URI of the form <scheme>:<rest>");
  }
  const scheme = schemeMatch[1];
  if (scheme !== scheme.toLowerCase()) throw new InvalidReferenceError("reference scheme must be lowercase");

  if (scheme === "agentproof") {
    if (!RECEIPT.test(reference)) throw new InvalidReferenceError("receipt references must be agentproof:sha256:<64 lowercase hex>");
    return { reference, kind: "receipt" };
  }
  if (scheme === "recall") {
    if (!MEMORY.test(reference)) throw new InvalidReferenceError("Recall references must be recall:memory:<id>");
    return { reference, kind: "memory" };
  }
  if (scheme.startsWith("git+")) return parseCodeReference(reference);
  if (MODEL_CALL.test(reference)) return { reference, kind: "model-call" };
  if (scheme === "ballast") {
    if (!KNOWLEDGE.test(reference)) {
      throw new InvalidReferenceError("BallastOS references must be ballast://source/knowledge:<id> or ballast:request:<id>");
    }
    return { reference, kind: "knowledge" };
  }
  return { reference, kind: "opaque" };
}

function parseCodeReference(reference: string): ParsedReference {
  const match = reference.match(CODE);
  if (!match) {
    throw new InvalidReferenceError("code references must be git+<url>@<40-hex commit>#<path>[:L<start>-L<end>]");
  }
  const range = match[3].match(LINE_RANGE);
  const path = range ? match[3].slice(0, -range[0].length) : match[3];
  if (!path || /:L\d+(-|$)/.test(path)) throw new InvalidReferenceError("code reference path is missing or has a malformed line range");
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start < 1 || end < start) throw new InvalidReferenceError("code reference line range must satisfy 1 <= start <= end");
  }
  return {
    reference,
    kind: "code",
    path_reference: `git+${match[1]}@${match[2]}#${path}`,
    has_line_range: Boolean(range),
  };
}

export function isValidReference(input: string): boolean {
  try { parseReference(input); return true; }
  catch { return false; }
}

/**
 * References in a decision's `evidence` field: one URI per line, after any free
 * text. Only known schemes count here, so a free-text line such as "todo:later"
 * never turns into a link. Duplicates are dropped, order is kept.
 */
export function extractEvidenceReferences(evidence: string | null | undefined): string[] {
  if (!evidence) return [];
  const found = new Set<string>();
  for (const line of evidence.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate) continue;
    try {
      const parsed = parseReference(candidate);
      if (parsed.kind !== "opaque") found.add(parsed.reference);
    } catch { /* free text */ }
  }
  return [...found];
}
