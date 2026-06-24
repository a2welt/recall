import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getAiConfig, lockAiConfig, saveAiConfig, unlockAiConfig, updateAiConfig } from "../src/ai/config.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "recall-ai-")); process.env.RECALL_AI_CONFIG_PATH = join(dir, "config.enc.json"); lockAiConfig(); });
afterEach(async () => { lockAiConfig(); delete process.env.RECALL_AI_CONFIG_PATH; await rm(dir, { recursive: true, force: true }); });

const config = { providers: [{ id: "local", name: "Ollama", kind: "ollama" as const, baseUrl: "http://127.0.0.1:11434", model: "llama3.2" }], activeProviderId: "local" };

describe("encrypted AI configuration", () => {
  it("round trips without writing plaintext provider data", async () => {
    await saveAiConfig(config, "correct horse battery staple"); lockAiConfig();
    const raw = await readFile(process.env.RECALL_AI_CONFIG_PATH!, "utf8"); expect(raw).not.toContain("llama3.2");
    await unlockAiConfig("correct horse battery staple"); expect(getAiConfig()).toEqual(config);
  });
  it("rejects an incorrect passphrase", async () => { await saveAiConfig(config, "correct horse battery staple"); lockAiConfig(); await expect(unlockAiConfig("incorrect passphrase")).rejects.toMatchObject({ code: "AUTH" }); });
  it("rejects tampered ciphertext", async () => { await saveAiConfig(config, "correct horse battery staple"); lockAiConfig(); const path = process.env.RECALL_AI_CONFIG_PATH!; const envelope = JSON.parse(await readFile(path, "utf8")); envelope.ciphertext = `${envelope.ciphertext.slice(0, -2)}AA`; await writeFile(path, JSON.stringify(envelope)); await expect(unlockAiConfig("correct horse battery staple")).rejects.toMatchObject({ code: "AUTH" }); });
  it("persists model edits while the session is unlocked", async () => { await saveAiConfig(config, "correct horse battery staple"); await updateAiConfig({ ...config, providers: [{ ...config.providers[0], model: "qwen3:8b" }] }); lockAiConfig(); await unlockAiConfig("correct horse battery staple"); expect(getAiConfig().providers[0].model).toBe("qwen3:8b"); });
});
