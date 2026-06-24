import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDb } from "../db/index.js";
import { unlockAiConfig, lockAiConfig } from "../ai/config.js";
import { generateArtifacts } from "../ai/generate.js";
import type { ArtifactName, HandoffTarget } from "../ai/types.js";
import { askSecret } from "./ai.js";

export async function generateHandoffCommand(memoryId: string, opts: { target: HandoffTarget; types: string; out: string; instructions?: string; force?: boolean; provider?: string }): Promise<void> {
  const artifactMap: Record<string, ArtifactName> = { spec: "SPEC.md", "spec.md": "SPEC.md", prompt: "PROMPT.md", "prompt.md": "PROMPT.md", skill: "SKILL.md", "skill.md": "SKILL.md" };
  const artifacts = opts.types.split(",").map((item) => artifactMap[item.trim().toLowerCase()]).filter(Boolean) as ArtifactName[];
  const passphrase = await askSecret("AI configuration passphrase"); await unlockAiConfig(passphrase);
  try {
    const result = await generateArtifacts(getDb(), { memoryId, providerId: opts.provider, target: opts.target, artifacts, instructions: opts.instructions }); await mkdir(opts.out, { recursive: true });
    const manifest = { source_memory_id: result.memoryId, target: result.target, provider: result.providerName, model: result.model, generated_at: result.generatedAt, included_files: Object.keys(result.files) };
    const files: Record<string, string> = { ...result.files as Record<string, string>, "manifest.json": JSON.stringify(manifest, null, 2) };
    for (const [name, content] of Object.entries(files)) { const path = join(opts.out, name); if (!opts.force) { try { await access(path); throw new Error(`${path} already exists. Use --force to overwrite.`); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } } await writeFile(path, content, "utf8"); }
    process.stdout.write(`Generated ${Object.keys(result.files).join(", ")} in ${opts.out}\n`);
  } finally { lockAiConfig(); }
}
