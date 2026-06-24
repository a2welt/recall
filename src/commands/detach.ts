import { clearIdeaContext, getDb } from "../db/index.js";

export async function detachCommand(id: string): Promise<void> {
  const db = getDb();
  const matches = db.prepare(`SELECT id FROM ideas WHERE id = ? OR id LIKE ? LIMIT 2`).all(id, `${id}%`) as unknown as Array<{ id: string }>;
  const unique = [...new Set(matches.map((match) => match.id))];
  if (unique.length === 0) throw new Error(`Memory ${id} not found.`);
  if (unique.length > 1) throw new Error(`Prefix ${id} is ambiguous. Use more characters.`);
  if (!clearIdeaContext(db, unique[0])) throw new Error(`Memory ${unique[0]} has no context record.`);
  console.log(`✓ Detached ${unique[0]} from repository context.`);
}
