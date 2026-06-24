import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import envPaths from "env-paths";
import type { AiConfig, AiProviderConfig } from "./types.js";
import { AiError } from "./types.js";

const AUTO_LOCK_MS = 30 * 60 * 1000;

interface EncryptedEnvelope { version: 1; salt: string; iv: string; tag: string; ciphertext: string; verifier: string }
let unlocked: AiConfig | null = null;
let activeKey: Buffer | null = null;
let activeSalt: Buffer | null = null;
let lockTimer: NodeJS.Timeout | null = null;

async function derive(passphrase: string, salt: Buffer): Promise<Buffer> {
  if (passphrase.length < 8) throw new AiError("INVALID", "Passphrase must be at least 8 characters.");
  return new Promise((resolve, reject) => scryptCallback(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(Buffer.from(key))));
}

function touch(): void {
  if (lockTimer) clearTimeout(lockTimer);
  lockTimer = setTimeout(lockAiConfig, AUTO_LOCK_MS);
  lockTimer.unref?.();
}

export async function isAiConfigured(): Promise<boolean> {
  try { await readFile(aiConfigPath()); return true; } catch { return false; }
}

export function isAiUnlocked(): boolean { return unlocked !== null; }

export async function saveAiConfig(config: AiConfig, passphrase: string): Promise<void> {
  validateConfig(config);
  const salt = randomBytes(16); const iv = randomBytes(12); const key = await derive(passphrase, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  const verifier = createCipheriv("aes-256-gcm", key, Buffer.alloc(12)).update("recall-ai-config").subarray(0, 16);
  const envelope: EncryptedEnvelope = { version: 1, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"), verifier: verifier.toString("base64") };
  const path = aiConfigPath(); await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });
  unlocked = structuredClone(config); activeKey = key; activeSalt = salt; touch();
}

export async function unlockAiConfig(passphrase: string): Promise<AiConfig> {
  let envelope: EncryptedEnvelope;
  try { envelope = JSON.parse(await readFile(aiConfigPath(), "utf8")) as EncryptedEnvelope; } catch { throw new AiError("NOT_CONFIGURED", "AI provider configuration does not exist.", 404); }
  try {
    const salt = Buffer.from(envelope.salt, "base64"); const key = await derive(passphrase, salt);
    const expected = createCipheriv("aes-256-gcm", key, Buffer.alloc(12)).update("recall-ai-config").subarray(0, 16);
    if (!timingSafeEqual(expected, Buffer.from(envelope.verifier, "base64"))) throw new Error("invalid passphrase");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const config = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8")) as AiConfig;
    validateConfig(config); unlocked = config; activeKey = key; activeSalt = salt; touch(); return structuredClone(config);
  } catch (error) { if (error instanceof AiError) throw error; throw new AiError("AUTH", "Incorrect passphrase or damaged AI configuration.", 401); }
}

export function lockAiConfig(): void { unlocked = null; activeKey?.fill(0); activeSalt?.fill(0); activeKey = null; activeSalt = null; if (lockTimer) clearTimeout(lockTimer); lockTimer = null; }

export async function updateAiConfig(config: AiConfig): Promise<void> {
  if (!unlocked || !activeKey || !activeSalt) throw new AiError("LOCKED", "AI configuration is locked.", 423);
  validateConfig(config); const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", activeKey, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  const verifier = createCipheriv("aes-256-gcm", activeKey, Buffer.alloc(12)).update("recall-ai-config").subarray(0, 16);
  const envelope: EncryptedEnvelope = { version: 1, salt: activeSalt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64"), verifier: verifier.toString("base64") };
  await writeFile(aiConfigPath(), JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 }); unlocked = structuredClone(config); touch();
}

export function getAiConfig(): AiConfig {
  if (!unlocked) throw new AiError("LOCKED", "AI configuration is locked.", 423);
  touch(); return structuredClone(unlocked);
}

export function redactedConfig(config: AiConfig): AiConfig {
  return { ...config, providers: config.providers.map((provider) => ({ ...provider, apiKey: provider.apiKey ? "••••••••" : undefined })) };
}

export function providerById(id?: string): AiProviderConfig {
  const config = getAiConfig(); const provider = config.providers.find((item) => item.id === (id || config.activeProviderId));
  if (!provider) throw new AiError("NOT_CONFIGURED", "Selected AI provider is not configured.", 404); return provider;
}

function validateConfig(config: AiConfig): void {
  if (!Array.isArray(config.providers) || !config.providers.length) throw new AiError("INVALID", "At least one provider is required.");
  for (const provider of config.providers) {
    if (!provider.id || !provider.name || !provider.kind || !provider.baseUrl || !provider.model) throw new AiError("INVALID", "Each provider requires id, name, type, base URL, and model.");
    if (provider.kind !== "ollama" && !provider.apiKey) throw new AiError("INVALID", `${provider.name} requires an API key.`);
    try { new URL(provider.baseUrl); } catch { throw new AiError("INVALID", `${provider.name} has an invalid base URL.`); }
  }
  if (!config.providers.some((provider) => provider.id === config.activeProviderId)) throw new AiError("INVALID", "Active provider is missing.");
}

export function aiConfigPath(): string { return process.env.RECALL_AI_CONFIG_PATH || join(envPaths("recall", { suffix: "" }).config, "ai-config.enc.json"); }
