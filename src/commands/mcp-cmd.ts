import { startMcpServer } from "../mcp/server.js";

export async function mcpCommand(): Promise<void> {
  // Ensure DB is initialized before the server starts listening
  const { getDb } = await import("../db/index.js");
  getDb();

  await startMcpServer();
}
