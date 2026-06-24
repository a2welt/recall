import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { aiConfigPath, getAiConfig, isAiConfigured, lockAiConfig, saveAiConfig, unlockAiConfig } from "../ai/config.js";
import type { AiProviderConfig, ProviderKind } from "../ai/types.js";

async function ask(label: string, fallback?: string): Promise<string> { const rl = createInterface({ input: stdin, output: stdout }); try { const answer = (await rl.question(`${label}${fallback ? ` (${fallback})` : ""}: `)).trim(); return answer || fallback || ""; } finally { rl.close(); } }
export async function askSecret(label: string): Promise<string> {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error(`${label} must be entered in an interactive terminal.`);
  stdout.write(`${label}: `); stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => { let value = ""; const onData = (chunk: string) => { for (const char of chunk) { if (char === "\r" || char === "\n") { cleanup(); stdout.write("\n"); resolve(value); return; } if (char === "\u0003") { cleanup(); reject(new Error("Cancelled")); return; } if (char === "\u007f" || char === "\b") { if (value) { value = value.slice(0, -1); stdout.write("\b \b"); } } else { value += char; stdout.write("*"); } } }; const cleanup = () => { stdin.off("data", onData); stdin.setRawMode(false); stdin.pause(); }; stdin.on("data", onData); });
}

export async function configureAi(opts: { provider?: ProviderKind; name?: string; model?: string; baseUrl?: string; apiKey?: string }): Promise<void> {
  const configured = await isAiConfigured(); let existing = { providers: [] as AiProviderConfig[], activeProviderId: "" }; let passphrase = "";
  if (configured) { passphrase = await askSecret("Current AI configuration passphrase"); await unlockAiConfig(passphrase); existing = getAiConfig(); }
  const kind = (opts.provider || await ask("Provider (ollama/openai/anthropic)", "ollama")) as ProviderKind;
  if (!["ollama", "openai", "anthropic"].includes(kind)) throw new Error("Provider must be ollama, openai, or anthropic.");
  const defaults = kind === "ollama" ? { name: "Local Ollama", url: "http://127.0.0.1:11434", model: "llama3.2" } : kind === "openai" ? { name: "OpenAI compatible", url: "https://api.openai.com/v1", model: "gpt-4.1-mini" } : { name: "Anthropic", url: "https://api.anthropic.com", model: "claude-sonnet-4-5" };
  const provider: AiProviderConfig = { id: randomUUID(), kind, name: opts.name || await ask("Display name", defaults.name), baseUrl: opts.baseUrl || await ask("Base URL", defaults.url), model: opts.model || await ask("Model", defaults.model) };
  if (kind !== "ollama") provider.apiKey = opts.apiKey || await askSecret("API key");
  if (!configured) { passphrase = await askSecret("Encryption passphrase (minimum 8 characters)"); const confirm = await askSecret("Confirm passphrase"); if (passphrase !== confirm) throw new Error("Passphrases do not match."); }
  await saveAiConfig({ providers: [...existing.providers, provider], activeProviderId: provider.id }, passphrase); lockAiConfig(); stdout.write(`AI provider encrypted at ${aiConfigPath()}\n`);
}

export async function aiStatus(): Promise<void> { stdout.write((await isAiConfigured()) ? `AI configuration: encrypted (${aiConfigPath()})\n` : "AI configuration: not configured\n"); }
export async function aiLock(): Promise<void> { lockAiConfig(); stdout.write("AI configuration locked.\n"); }
