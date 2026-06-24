import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import envPaths from "env-paths";
import { getDb, getIdeaById, insertIdea, listIdeas, listProjects } from "../db/index.js";
import { inferTopic } from "../topic.js";

export interface MobileSyncConfig { inboxId: string; accessToken: string; encryptionKey: string; workerUrl: string; pagesUrl: string; createdAt: string }
interface EncryptedCapture { id: string; iv: string; ciphertext: string; created_at: string }
interface MobileCapture { id: string; content: string; topic?: string; project?: string; created_at: string }

const configPath = () => process.env.RECALL_MOBILE_CONFIG_PATH || join(envPaths("recall", { suffix: "" }).config, "mobile-sync.json");
const base64url = (value: Buffer) => value.toString("base64url");

export async function getMobileSyncConfig(): Promise<MobileSyncConfig | null> { try { return JSON.parse(await readFile(configPath(), "utf8")) as MobileSyncConfig; } catch { return null; } }

export async function setupMobileSync(workerUrl: string, pagesUrl: string): Promise<{ config: MobileSyncConfig; pairingUrl: string }> {
  const config: MobileSyncConfig = { inboxId: base64url(randomBytes(18)), accessToken: base64url(randomBytes(32)), encryptionKey: base64url(randomBytes(32)), workerUrl: workerUrl.replace(/\/$/, ""), pagesUrl: pagesUrl.replace(/\/$/, ""), createdAt: new Date().toISOString() };
  const response = await fetch(`${config.workerUrl}/v1/inboxes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inbox_id: config.inboxId, access_token: config.accessToken }) });
  if (!response.ok) throw new Error(`Mobile sync service rejected setup (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const path = configPath(); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });
  await publishMobileSnapshot(config).catch(() => undefined); return { config, pairingUrl: pairingUrl(config) };
}

export function pairingUrl(config: MobileSyncConfig): string { return `${config.pagesUrl}/?inbox=${encodeURIComponent(config.inboxId)}#key=${config.encryptionKey}&token=${config.accessToken}`; }
export function redactedMobileConfig(config: MobileSyncConfig | null) { return config ? { configured: true, inbox_id: config.inboxId, worker_url: config.workerUrl, pages_url: config.pagesUrl, created_at: config.createdAt, pairing_url: pairingUrl(config) } : { configured: false }; }

export async function pullMobileCaptures(): Promise<{ imported: number; pending: number; published: boolean }> {
  const config = await getMobileSyncConfig(); if (!config) return { imported: 0, pending: 0, published: false };
  const response = await fetch(`${config.workerUrl}/v1/inboxes/${encodeURIComponent(config.inboxId)}/captures`, { headers: { Authorization: `Bearer ${config.accessToken}` } });
  if (!response.ok) throw new Error(`Mobile sync failed (${response.status})`);
  const payload = await response.json() as { captures?: EncryptedCapture[] }; const captures = payload.captures ?? []; let imported = 0;
  for (const encrypted of captures) {
    try {
      const capture = decryptCapture(encrypted, config.encryptionKey); const db = getDb();
      if (!getIdeaById(db, capture.id)) {
        const projectId = capture.project ? listProjects(db).find((project) => project.name.toLowerCase() === capture.project!.toLowerCase())?.id : undefined;
        insertIdea(db, { id: capture.id, content: capture.content, source: "cli", source_path: "mobile", topic: capture.topic?.trim() || inferTopic(capture.content), project_id: projectId ?? null, workflow_status: "backlog" }); imported += 1;
      }
      await fetch(`${config.workerUrl}/v1/inboxes/${encodeURIComponent(config.inboxId)}/captures/${encodeURIComponent(encrypted.id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${config.accessToken}` } });
    } catch (error) { console.warn(`Skipped invalid mobile capture ${hashId(encrypted.id)}: ${(error as Error).message}`); }
  }
  const published = await publishMobileSnapshot(config).then(() => true).catch(() => false); return { imported, pending: Math.max(0, captures.length - imported), published };
}

export async function publishMobileSnapshot(configOverride?: MobileSyncConfig): Promise<void> {
  const config = configOverride ?? await getMobileSyncConfig(); if (!config) return;
  const db = getDb(); const projects = listProjects(db); const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const payload = { version: 1, generated_at: new Date().toISOString(), memories: listIdeas(db).map((idea) => ({ id: idea.id, content: idea.content, topic: idea.topic || inferTopic(idea.content), category: idea.category, priority: idea.priority, status: idea.status, workflow_status: idea.workflow_status, project: idea.project_id ? projectNames.get(idea.project_id) ?? "Inbox" : "Inbox", created_at: idea.created_at })) };
  const compressed = gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 }); const key = Buffer.from(config.encryptionKey, "base64url"); const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final(), cipher.getAuthTag()]);
  const response = await fetch(`${config.workerUrl}/v1/inboxes/${encodeURIComponent(config.inboxId)}/snapshot`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.accessToken}` }, body: JSON.stringify({ iv: iv.toString("base64url"), ciphertext: ciphertext.toString("base64url"), encoding: "gzip+json" }) });
  if (!response.ok) throw new Error(`Mobile catalog publish failed (${response.status})`);
}

function decryptCapture(capture: EncryptedCapture, keyText: string): MobileCapture {
  const key = Buffer.from(keyText, "base64url"); const packed = Buffer.from(capture.ciphertext, "base64url"); if (packed.length < 17) throw new Error("ciphertext too short");
  const tag = packed.subarray(packed.length - 16); const data = packed.subarray(0, -16); const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(capture.iv, "base64url")); decipher.setAuthTag(tag);
  const value = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")) as MobileCapture;
  if (!value.id || !value.content?.trim() || value.content.length > 20_000) throw new Error("invalid capture"); return value;
}
function hashId(id: string) { return createHash("sha256").update(id).digest("hex").slice(0, 8); }

export function startMobileSyncPolling(): NodeJS.Timeout {
  const timer = setInterval(() => { void pullMobileCaptures().catch(() => undefined); }, 60_000); timer.unref(); return timer;
}
