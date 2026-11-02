import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createRequestHandler } from "../src/server/index.js";
import { createServerSecurity } from "../src/server/security.js";
import { insertIdea, setDb } from "../src/db/index.js";
import { createTestDb } from "./helpers.js";

const TOKEN = "test-token-links-0123456789";
const DIGEST = "0f".repeat(32);
const RECEIPT = `agentproof:sha256:${DIGEST}`;
const FILE = `git+https://github.com/findajay/Open-model-fabric@${"a".repeat(40)}#python/omf/core/services/routing.py`;

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
  server.on("request", createRequestHandler(createServerSecurity(port, { RECALL_API_TOKEN: TOKEN })));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const db = createTestDb();
  setDb(db);
  insertIdea(db, { id: "m1", content: "Route by cost", source: "cli", decision: { decision: "Cheapest passing model", evidence: `Measured in staging\n${RECEIPT}` } });
  insertIdea(db, { id: "m2", content: "Keep a fallback model", source: "cli" });
});

function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1", port, path, method,
        headers: { host: `127.0.0.1:${port}`, ...(payload ? { "content-type": "application/json" } : {}), ...headers },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: raw ? JSON.parse(raw) : null }));
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

const q = (value: string) => encodeURIComponent(value);

describe("links API access control", () => {
  it.each([
    ["GET", "/api/links"],
    ["GET", `/api/links?reference=${q(RECEIPT)}`],
    ["GET", "/api/ideas/m1/links"],
    ["POST", "/api/ideas/m1/links"],
    ["DELETE", `/api/ideas/m1/links?reference=${q(RECEIPT)}`],
  ])("%s %s requires the token", async (method, path) => {
    expect((await call(method, path, method === "POST" ? { reference: FILE } : undefined, {})).status).toBe(401);
    expect((await call(method, path, undefined, { authorization: "Bearer wrong" })).status).toBe(401);
  });

  it("refuses a cross-site write even with the token", async () => {
    const res = await call("POST", "/api/ideas/m1/links", { reference: FILE }, { authorization: `Bearer ${TOKEN}`, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("links API", () => {
  it("lists a memory's links, including those from evidence", async () => {
    const res = await call("GET", "/api/ideas/m1/links");
    expect(res.status).toBe(200);
    expect(res.json.memory_id).toBe("m1");
    expect(res.json.links).toEqual([expect.objectContaining({ memory_id: "m1", reference: RECEIPT, relation: "related" })]);
  });

  it("returns 404 for an unknown memory", async () => {
    expect((await call("GET", "/api/ideas/nope/links")).status).toBe(404);
    expect((await call("POST", "/api/ideas/nope/links", { reference: FILE })).status).toBe(404);
  });

  it("adds a link: 201 when new, 200 when it already exists", async () => {
    const first = await call("POST", "/api/ideas/m2/links", { reference: `${FILE}:L40-L72`, relation: "constrains" });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ memory_id: "m2", reference: `${FILE}:L40-L72`, relation: "constrains", created: true });
    const again = await call("POST", "/api/ideas/m2/links", { reference: `${FILE}:L40-L72`, relation: "constrains" });
    expect(again.status).toBe(200);
    expect(again.json.created).toBe(false);
  });

  it("rejects invalid references and relations with 400", async () => {
    expect((await call("POST", "/api/ideas/m2/links", { reference: "agentproof:sha256:nope" })).status).toBe(400);
    expect((await call("POST", "/api/ideas/m2/links", {})).status).toBe(400);
    const badRelation = await call("POST", "/api/ideas/m2/links", { reference: FILE, relation: "mentions" });
    expect(badRelation.status).toBe(400);
    expect(badRelation.json.error).toMatch(/relation must be one of/);
    expect((await call("GET", "/api/links?reference=Not%20a%20uri")).status).toBe(400);
  });

  it("removes a link", async () => {
    await call("POST", "/api/ideas/m2/links", { reference: FILE, relation: "explains" });
    await call("POST", "/api/ideas/m2/links", { reference: FILE, relation: "related" });
    const one = await call("DELETE", `/api/ideas/m2/links?reference=${q(FILE)}&relation=explains`);
    expect(one.status).toBe(200);
    expect(one.json.removed).toBe(1);
    const rest = await call("DELETE", `/api/ideas/m2/links?reference=${q(FILE)}`);
    expect(rest.json.removed).toBe(1);
    expect((await call("DELETE", `/api/ideas/m2/links?reference=${q(FILE)}`)).status).toBe(404);
    expect((await call("DELETE", "/api/ideas/m2/links")).status).toBe(400);
  });

  it("finds memories by reference, matching a file against its line ranges", async () => {
    await call("POST", "/api/ideas/m1/links", { reference: `${FILE}:L40-L72`, relation: "constrains" });
    await call("POST", "/api/ideas/m2/links", { reference: FILE, relation: "explains" });

    const byFile = await call("GET", `/api/links?reference=${q(FILE)}`);
    expect(byFile.status).toBe(200);
    expect(byFile.json.match).toBe("path");
    expect(byFile.json.links.map((link: { memory_id: string }) => link.memory_id).sort()).toEqual(["m1", "m2"]);
    expect(byFile.json.links.find((link: { memory_id: string }) => link.memory_id === "m1").memory.decision).toBe("Cheapest passing model");

    const byRange = await call("GET", `/api/links?reference=${q(`${FILE}:L40-L72`)}`);
    expect(byRange.json.match).toBe("exact");
    expect(byRange.json.links).toHaveLength(1);

    const constrains = await call("GET", `/api/links?reference=${q(FILE)}&relation=constrains`);
    expect(constrains.json.links.map((link: { memory_id: string }) => link.memory_id)).toEqual(["m1"]);
  });

  it("accepts a reference whose + is not percent-encoded", async () => {
    await call("POST", "/api/ideas/m2/links", { reference: FILE });
    const res = await call("GET", `/api/links?reference=${FILE.replace("#", "%23")}`);
    expect(res.status).toBe(200);
    expect(res.json.reference).toBe(FILE);
    expect(res.json.links).toHaveLength(1);
  });

  it("finds the decisions behind a receipt", async () => {
    const res = await call("GET", `/api/links?reference=${q(RECEIPT)}`);
    expect(res.json.links.map((link: { memory_id: string }) => link.memory_id)).toEqual(["m1"]);
  });

  it("lists every link for the memory graph", async () => {
    await call("POST", "/api/ideas/m2/links", { reference: "recall:memory:m1", relation: "supersedes" });
    const all = await call("GET", "/api/links");
    expect(all.json.links).toHaveLength(2);
    const supersedes = await call("GET", "/api/links?relation=supersedes");
    expect(supersedes.json.links).toEqual([expect.objectContaining({ memory_id: "m2", reference: "recall:memory:m1" })]);
    expect((await call("GET", "/api/links?relation=nope")).status).toBe(400);
  });
});
