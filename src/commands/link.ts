import { addIdeaLink, findLinksByReference, getDb, isLinkRelation, listIdeaLinks, removeIdeaLink, resolveIdeaId } from "../db/index.js";
import type { LinkRelation } from "../types.js";
import { LINK_RELATIONS } from "../types.js";

export interface LinkOptions {
  relation?: string;
}

export interface LinksOptions {
  reference?: string;
  relation?: string;
  json?: boolean;
}

function relationOption(value: string | undefined): LinkRelation | undefined {
  if (value === undefined) return undefined;
  if (!isLinkRelation(value)) throw new Error(`--relation must be one of: ${LINK_RELATIONS.join(", ")}.`);
  return value;
}

function memoryId(idOrPrefix: string): string {
  const id = resolveIdeaId(getDb(), idOrPrefix);
  if (!id) throw new Error(`Memory ${idOrPrefix} not found, or the prefix is ambiguous.`);
  return id;
}

export async function linkCommand(id: string, reference: string, opts: LinkOptions): Promise<void> {
  const fullId = memoryId(id);
  const result = addIdeaLink(getDb(), fullId, reference, relationOption(opts.relation) ?? "related");
  if (!result) throw new Error(`Memory ${id} not found.`);
  const { link, created } = result;
  console.log(`${created ? "✓ Linked" : "Already linked"} ${link.memory_id} —${link.relation}→ ${link.reference}`);
}

export async function unlinkCommand(id: string, reference: string, opts: LinkOptions): Promise<void> {
  const fullId = memoryId(id);
  const removed = removeIdeaLink(getDb(), fullId, reference, relationOption(opts.relation));
  if (!removed) throw new Error(`No link from ${fullId} to ${reference}${opts.relation ? ` (${opts.relation})` : ""}.`);
  console.log(`✓ Removed ${removed} link${removed === 1 ? "" : "s"} from ${fullId} to ${reference}`);
}

export async function linksCommand(id: string | undefined, opts: LinksOptions): Promise<void> {
  const relation = relationOption(opts.relation);
  if (opts.reference) {
    const search = findLinksByReference(getDb(), opts.reference, relation);
    if (opts.json) { console.log(JSON.stringify(search, null, 2)); return; }
    if (!search.links.length) { console.log(`No memories linked to ${search.reference}.`); return; }
    for (const link of search.links) {
      const summary = (link.memory.decision ?? link.memory.content).split("\n")[0].slice(0, 80);
      console.log(`${link.memory_id.slice(0, 8)}  ${link.relation.padEnd(10)}  ${summary}`);
      if (link.reference !== search.reference) console.log(`          ${link.reference}`);
    }
    return;
  }
  if (!id) throw new Error("Pass a memory id, or --reference <uri> to find the memories linked to it.");
  const fullId = memoryId(id);
  const links = listIdeaLinks(getDb(), fullId).filter((link) => !relation || link.relation === relation);
  if (opts.json) { console.log(JSON.stringify({ memory_id: fullId, links }, null, 2)); return; }
  if (!links.length) { console.log(`No links on ${fullId}.`); return; }
  for (const link of links) console.log(`${link.relation.padEnd(10)}  ${link.reference}`);
}
