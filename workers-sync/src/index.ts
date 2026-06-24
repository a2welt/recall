interface Env { DB: D1Database; PAGES_ORIGIN: string }
interface CaptureBody { id?: string; iv?: string; ciphertext?: string; created_at?: string }
interface SnapshotBody { iv?: string; ciphertext?: string; encoding?: string }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin"); const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !cors["Access-Control-Allow-Origin"]) return response({ error: "Origin not allowed" }, 403, cors);
    const url = new URL(request.url); const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (request.method === "POST" && url.pathname === "/v1/inboxes") {
        const body = await readJson<{ inbox_id?: string; access_token?: string }>(request); if (!validId(body.inbox_id) || !body.access_token || body.access_token.length < 32) return response({ error: "Invalid inbox registration" }, 400, cors);
        await env.DB.prepare("INSERT OR IGNORE INTO inboxes (id, token_hash) VALUES (?, ?)").bind(body.inbox_id, await sha256(body.access_token)).run(); return response({ created: true }, 201, cors);
      }
      if (parts[0] === "v1" && parts[1] === "inboxes" && validId(parts[2])) {
        const inboxId = parts[2]; if (!await authorized(request, env, inboxId)) return response({ error: "Unauthorized" }, 401, cors);
        if (request.method === "POST" && parts[3] === "captures" && parts.length === 4) {
          const body = await readJson<CaptureBody>(request); if (!validId(body.id) || !validBlob(body.iv, 128) || !validBlob(body.ciphertext, 80_000) || !body.created_at) return response({ error: "Invalid encrypted capture" }, 400, cors);
          const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM captures WHERE inbox_id = ?").bind(inboxId).first<{ count: number }>(); if ((count?.count ?? 0) >= 1000) return response({ error: "Inbox capacity reached" }, 429, cors);
          await env.DB.prepare("INSERT OR IGNORE INTO captures (id, inbox_id, iv, ciphertext, created_at) VALUES (?, ?, ?, ?, ?)").bind(body.id, inboxId, body.iv, body.ciphertext, body.created_at).run(); return response({ accepted: true }, 202, cors);
        }
        if (request.method === "GET" && parts[3] === "captures" && parts.length === 4) {
          const result = await env.DB.prepare("SELECT id, iv, ciphertext, created_at FROM captures WHERE inbox_id = ? ORDER BY received_at LIMIT 200").bind(inboxId).all(); return response({ captures: result.results }, 200, cors);
        }
        if (request.method === "DELETE" && parts[3] === "captures" && validId(parts[4])) { await env.DB.prepare("DELETE FROM captures WHERE inbox_id = ? AND id = ?").bind(inboxId, parts[4]).run(); return response({ deleted: true }, 200, cors); }
        if (parts[3] === "snapshot" && parts.length === 4 && request.method === "PUT") {
          const body = await readJson<SnapshotBody>(request, 2_500_000); if (!validBlob(body.iv, 128) || !validBlob(body.ciphertext, 2_400_000) || body.encoding !== "gzip+json") return response({ error: "Invalid encrypted snapshot" }, 400, cors);
          await env.DB.prepare("INSERT INTO snapshots (inbox_id, iv, ciphertext, encoding, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(inbox_id) DO UPDATE SET iv=excluded.iv, ciphertext=excluded.ciphertext, encoding=excluded.encoding, updated_at=CURRENT_TIMESTAMP").bind(inboxId, body.iv, body.ciphertext, body.encoding).run(); return response({ stored: true }, 200, cors);
        }
        if (parts[3] === "snapshot" && parts.length === 4 && request.method === "GET") { const snapshot = await env.DB.prepare("SELECT iv, ciphertext, encoding, updated_at FROM snapshots WHERE inbox_id = ?").bind(inboxId).first(); return snapshot ? response({ snapshot }, 200, cors) : response({ snapshot: null }, 200, cors); }
      }
      return response({ error: "Not found" }, 404, cors);
    } catch (error) { return response({ error: error instanceof Error ? error.message : "Request failed" }, 500, cors); }
  },
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> { await env.DB.prepare("DELETE FROM captures WHERE received_at < datetime('now', '-30 days')").run(); },
};

async function authorized(request: Request, env: Env, inboxId: string): Promise<boolean> { const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, ""); if (!token) return false; const row = await env.DB.prepare("SELECT token_hash FROM inboxes WHERE id = ?").bind(inboxId).first<{ token_hash: string }>(); return Boolean(row && row.token_hash === await sha256(token)); }
async function sha256(value: string): Promise<string> { const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
async function readJson<T>(request: Request, max = 100_000): Promise<T> { const length = Number(request.headers.get("Content-Length") || 0); if (length > max) throw new Error("Request too large"); return request.json<T>(); }
const validId = (value?: string): value is string => Boolean(value && /^[A-Za-z0-9_-]{8,80}$/.test(value));
const validBlob = (value: string | undefined, max: number): value is string => Boolean(value && value.length <= max && /^[A-Za-z0-9_-]+$/.test(value));
function corsHeaders(origin: string | null, env: Env): Record<string, string> { const allowed = origin === env.PAGES_ORIGIN || Boolean(origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)); return { ...(allowed && origin ? { "Access-Control-Allow-Origin": origin } : {}), "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", Vary: "Origin" }; }
function response(body: unknown, status: number, headers: Record<string, string>): Response { return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json", "Cache-Control": "no-store" } }); }
