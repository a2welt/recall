import { getDb, resolveIdea } from "../db/index.js";

export async function resolveCommand(id: string): Promise<void> {
  const db = getDb();
  const changed = resolveIdea(db, id);
  if (!changed) {
    // Try prefix match (first 8 chars)
    const full = db
      .prepare(`SELECT id FROM ideas WHERE id LIKE ?`)
      .get(`${id}%`) as { id: string } | undefined;
    if (full) {
      resolveIdea(db, full.id);
      console.log(`✓ Resolved ${full.id}`);
    } else {
      console.error(`Error: idea ${id} not found.`);
      process.exit(1);
    }
  } else {
    console.log(`✓ Resolved ${id}`);
  }
}
