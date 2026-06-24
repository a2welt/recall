import { readFileSync, statSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { glob } from "glob";
import { v4 as uuidv4 } from "uuid";
import type { DatabaseSync } from "node:sqlite";
import { insertIdea, getIngestedSourcePaths } from "../db/index.js";
import type { IngestStats } from "../types.js";

const MAX_CONTENT_BYTES = 8_000;

function extractTitle(data: Record<string, unknown>, content: string): string {
  if (data.title && typeof data.title === "string") return data.title.trim();
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1].trim();
  const firstLine = content.split("\n").find((l) => l.trim().length > 0);
  return firstLine?.trim() ?? "(untitled)";
}

function buildEmbedText(title: string, body: string): string {
  return `${title}\n${body.slice(0, MAX_CONTENT_BYTES - title.length - 2)}`;
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, content: raw };
  const titleLine = match[1].split(/\r?\n/).find((line) => /^title\s*:/i.test(line));
  const rawTitle = titleLine?.replace(/^title\s*:\s*/i, "").trim();
  const title = rawTitle?.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_value, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
  const data: Record<string, unknown> = title ? { title } : {};
  return { data, content: raw.slice(match[0].length) };
}

export interface IngestOptions {
  vaultPath: string;
  db: DatabaseSync;
  onProgress?: (msg: string) => void;
}

export async function ingestVault(opts: IngestOptions): Promise<IngestStats> {
  const { vaultPath, db, onProgress } = opts;
  const absVault = resolve(vaultPath);
  const stats: IngestStats = { added: 0, skipped: 0, errors: 0 };

  const files = await glob("**/*.md", {
    cwd: absVault,
    absolute: true,
    ignore: ["**/node_modules/**", "**/.git/**"],
  });

  if (files.length === 0) {
    onProgress?.("No markdown files found.");
    return stats;
  }

  onProgress?.(`Found ${files.length} markdown file(s)…`);

  const alreadyIngested = getIngestedSourcePaths(db);

  for (const filePath of files) {
    try {
      const relPath = relative(absVault, filePath);
      const sourcePath = filePath;
      const mtime = statSync(filePath).mtime.toISOString();

      const lastIngested = alreadyIngested.get(sourcePath);
      // SQLite's default timestamp has one-second precision while filesystem
      // mtimes include milliseconds. Allow that precision gap when deciding
      // whether a file predates its last ingestion.
      const lastIngestedMs = lastIngested ? Date.parse(lastIngested.includes("T") ? lastIngested : `${lastIngested.replace(" ", "T")}Z`) : Number.NaN;
      if (lastIngested && new Date(mtime).getTime() <= lastIngestedMs + 999) {
        stats.skipped++;
        continue;
      }

      const raw = readFileSync(filePath, "utf-8");
      const { data, content } = parseFrontmatter(raw);

      if (content.trim().length === 0) {
        stats.skipped++;
        continue;
      }

      const title = extractTitle(data as Record<string, unknown>, content);
      const embedText = buildEmbedText(title, content);

      insertIdea(db, {
        id: uuidv4(),
        content: embedText.slice(0, 4096),
        source: "ingested",
        source_path: sourcePath,
        status: "open",
        context: { file_path: relPath },
      });

      stats.added++;
      onProgress?.(`  ✓ ${relPath}`);
    } catch (err) {
      stats.errors++;
      onProgress?.(`  ✗ Error ingesting ${filePath}: ${(err as Error).message}`);
    }
  }

  return stats;
}
