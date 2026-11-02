import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createRequestHandler } from "../src/server/index.js";
import { createServerSecurity, sessionCookie, SESSION_COOKIE } from "../src/server/security.js";
import type { ServerSecurity } from "../src/server/security.js";

const TOKEN = "test-token-0123456789";

let server: Server;
let port: number;
let security: ServerSecurity;

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  security = createServerSecurity(port, { RECALL_API_TOKEN: TOKEN });
  server.on("request", createRequestHandler(security));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(
  path: string,
  headers: Record<string, string> = {},
  method = "GET"
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

const bearer = { authorization: `Bearer ${TOKEN}` };

describe("local API access control", () => {
  it("rejects requests without a token", async () => {
    const res = await call("/api/context");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const res = await call("/api/context", { authorization: "Bearer not-the-token" });
    expect(res.status).toBe(401);
  });

  it("accepts the bearer token", async () => {
    const res = await call("/api/context", bearer);
    expect(res.status).toBe(200);
  });

  it("accepts the session cookie the UI receives", async () => {
    const res = await call("/api/context", { cookie: `theme=dark; ${SESSION_COOKIE}=${TOKEN}` });
    expect(res.status).toBe(200);
  });

  it("rejects a foreign Host even with a valid token (DNS rebinding)", async () => {
    const res = await call("/api/context", { ...bearer, host: `evil.example:${port}` });
    expect(res.status).toBe(403);
  });

  it("rejects a foreign Origin even with a valid token (cross-site request)", async () => {
    const res = await call("/api/ideas", { ...bearer, origin: "https://evil.example" }, "POST");
    expect(res.status).toBe(403);
  });

  it("accepts the server's own Origin", async () => {
    const res = await call("/api/context", { ...bearer, origin: `http://localhost:${port}` });
    expect(res.status).toBe(200);
  });

  it("routes on the path, ignoring the query string", async () => {
    const res = await call("/api/context?refresh=1", bearer);
    expect(res.status).toBe(200);
  });

  it("still returns 404 for unknown API paths", async () => {
    const res = await call("/api/nope?x=1", bearer);
    expect(res.status).toBe(404);
  });
});

describe("server security configuration", () => {
  it("generates a random token when RECALL_API_TOKEN is unset", () => {
    const a = createServerSecurity(4321, {});
    const b = createServerSecurity(4321, {});
    expect(a.tokenFromEnv).toBe(false);
    expect(a.token).toHaveLength(43);
    expect(a.token).not.toBe(b.token);
  });

  it("issues an HttpOnly, SameSite=Strict session cookie", () => {
    const cookie = sessionCookie(createServerSecurity(4321, { RECALL_API_TOKEN: TOKEN }));
    expect(cookie).toContain(`${SESSION_COOKIE}=${TOKEN}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });

  it("allows extra origins from RECALL_ALLOWED_ORIGINS", () => {
    const sec = createServerSecurity(4321, { RECALL_ALLOWED_ORIGINS: "http://localhost:5173, http://a.test" });
    expect(sec.allowedOrigins.has("http://localhost:5173")).toBe(true);
    expect(sec.allowedOrigins.has("http://a.test")).toBe(true);
  });
});
