/**
 * Local HTTP server — serves the embedded UI and REST API.
 * Zero extra dependencies: uses Node.js built-in `http` module only.
 */

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./api.js";
import { startMobileSyncPolling } from "../mobile/sync.js";

const uiDirectory = fileURLToPath(new URL("../ui/", import.meta.url));

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

async function serveUi(url: string, res: ServerResponse): Promise<void> {
  const pathname = decodeURIComponent(url.split("?")[0] ?? "/");
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(uiDirectory, safePath);

  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream" });
    res.end(file);
  } catch {
    // React owns client-side routing, so unknown browser routes receive the app shell.
    try {
      const index = await readFile(join(uiDirectory, "index.html"));
      res.writeHead(200, { "Content-Type": contentTypes[".html"] });
      res.end(index);
    } catch {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Recall UI is not built. Run `npm run build` first.");
    }
  }
}

export async function startServer(port: number = 4321): Promise<void> {
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? "/";

      // Serve API routes
      if (url.startsWith("/api/")) {
        const handled = await handleApiRequest(req, res);
        if (!handled) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        }
        return;
      }

      // Serve the compiled React application for all other routes.
      await serveUi(url, res);
    }
  );

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Try: recall serve --port <n>`));
      } else {
        reject(err);
      }
    });
  });

  console.log(`\nRecall UI  →  http://localhost:${port}`);
  console.log("Press Ctrl+C to stop.\n");
  startMobileSyncPolling();

  // Keep the process alive
  await new Promise<void>(() => {/* runs until SIGINT */});
}
