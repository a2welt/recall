import type { DatabaseSync } from "node:sqlite";
import { listIdeasWithoutEmbeddings, saveIdeaEmbedding } from "../db/index.js";
import { embed } from "./index.js";

export async function prepareSemanticQuery(
  db: DatabaseSync,
  query: string,
  onProgress?: (completed: number, total: number) => void,
): Promise<number[]> {
  const missing = listIdeasWithoutEmbeddings(db);
  for (let index = 0; index < missing.length; index += 1) {
    const memory = missing[index];
    saveIdeaEmbedding(db, memory.id, await embed(memory.content));
    onProgress?.(index + 1, missing.length);
  }
  return embed(query);
}
