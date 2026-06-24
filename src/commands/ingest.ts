import { getDb } from "../db/index.js";
import { ingestVault } from "../ingest/index.js";

export interface IngestOptions {
  watch?: boolean;
}

export async function ingestCommand(
  vaultPath: string,
  opts: IngestOptions
): Promise<void> {
  const db = getDb();

  if (opts.watch) {
    console.error("--watch is planned for phase 2; running one-shot ingest.");
  }

  console.log(`Ingesting vault at: ${vaultPath}`);

  const stats = await ingestVault({
    vaultPath,
    db,
    onProgress: (msg) => console.log(msg),
  });

  console.log(
    `\nDone — added: ${stats.added}, skipped: ${stats.skipped}, errors: ${stats.errors}`
  );

  if (stats.added === 0 && stats.skipped === 0) {
    console.log(
      "Hint: make sure the path contains .md files and is a readable directory."
    );
  }
}
