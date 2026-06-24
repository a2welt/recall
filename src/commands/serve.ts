import { getDb } from "../db/index.js";
import { startServer } from "../server/index.js";

export interface ServeOptions {
  port?: number;
  open?: boolean;
}

export async function serveCommand(opts: ServeOptions): Promise<void> {
  // Ensure DB is initialized
  getDb();

  const port = opts.port ?? 4321;

  if (opts.open) {
    // Lazy import to avoid pulling in platform-specific code at startup
    const { openUrl } = await import("../server/open.js");
    // Open after a brief delay to let the server start
    setTimeout(() => openUrl(`http://localhost:${port}`), 500);
  }

  await startServer(port);
}
