import type { AiProviderConfig } from "./types.js";
import { AiError } from "./types.js";

const TIMEOUT_MS = 90_000;

function endpoint(base: string, path: string): string { return `${base.replace(/\/$/, "")}${path}`; }

async function request(url: string, init: RequestInit, timeout = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      if (response.status === 401 || response.status === 403) throw new AiError("AUTH", "Provider rejected the API key.", 401);
      if (response.status === 404 && /model/i.test(body)) throw new AiError("MODEL", "Configured model was not found.", 400);
      throw new AiError("PROVIDER", `Provider request failed (${response.status}): ${body || response.statusText}`, 502);
    }
    return response;
  } catch (error) {
    if (error instanceof AiError) throw error;
    if ((error as Error).name === "AbortError") throw new AiError("TIMEOUT", "AI provider request timed out.", 504);
    throw new AiError("PROVIDER", `Could not reach AI provider: ${(error as Error).message}`, 502);
  } finally { clearTimeout(timer); }
}

export async function generateWithProvider(provider: AiProviderConfig, system: string, user: string, signal?: AbortSignal): Promise<string> {
  if (provider.kind === "ollama") {
    const response = await request(endpoint(provider.baseUrl, "/api/chat"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: provider.model, stream: false, format: "json", options: { temperature: 0.2, num_predict: 8192 }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal });
    const data = await response.json() as { message?: { content?: string } }; return data.message?.content ?? "";
  }
  if (provider.kind === "anthropic") {
    const response = await request(endpoint(provider.baseUrl, "/v1/messages"), { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": provider.apiKey ?? "", "anthropic-version": provider.apiVersion || "2023-06-01" }, body: JSON.stringify({ model: provider.model, max_tokens: 8000, system, messages: [{ role: "user", content: user }] }), signal });
    const data = await response.json() as { content?: Array<{ type: string; text?: string }> }; return data.content?.find((item) => item.type === "text")?.text ?? "";
  }
  const response = await request(endpoint(provider.baseUrl, "/chat/completions"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey ?? ""}` }, body: JSON.stringify({ model: provider.model, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }), signal });
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }; return data.choices?.[0]?.message?.content ?? "";
}

export async function discoverModels(provider: AiProviderConfig): Promise<string[]> {
  if (provider.kind === "ollama") {
    const response = await request(endpoint(provider.baseUrl, "/api/tags"), { method: "GET" }, 10_000); const data = await response.json() as { models?: Array<{ name: string }> }; return data.models?.map((item) => item.name) ?? [];
  }
  if (provider.kind === "openai") {
    const response = await request(endpoint(provider.baseUrl, "/models"), { method: "GET", headers: { Authorization: `Bearer ${provider.apiKey ?? ""}` } }, 10_000); const data = await response.json() as { data?: Array<{ id: string }> }; return data.data?.map((item) => item.id).sort() ?? [];
  }
  return [provider.model];
}

export async function testProvider(provider: AiProviderConfig): Promise<{ ok: true; models: string[] }> { return { ok: true, models: await discoverModels(provider) }; }
