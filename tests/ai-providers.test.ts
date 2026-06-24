import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverModels, generateWithProvider } from "../src/ai/providers.js";

afterEach(() => vi.unstubAllGlobals());
describe("AI provider adapters", () => {
  it("extracts Ollama JSON output", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: '{"SPEC.md":"# Spec"}' } }), { status: 200 }))); const output = await generateWithProvider({ id: "o", name: "Ollama", kind: "ollama", baseUrl: "http://localhost:11434", model: "test" }, "system", "user"); expect(output).toContain("SPEC.md"); });
  it("discovers OpenAI-compatible models without exposing the key", async () => { const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }] }), { status: 200 })); vi.stubGlobal("fetch", fetchMock); const models = await discoverModels({ id: "o", name: "OpenAI", kind: "openai", baseUrl: "https://example.test/v1", model: "model-a", apiKey: "secret" }); expect(models).toEqual(["model-a", "model-b"]); expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer secret"); });
  it("normalizes authentication failures", async () => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }))); await expect(discoverModels({ id: "o", name: "OpenAI", kind: "openai", baseUrl: "https://example.test/v1", model: "x", apiKey: "bad" })).rejects.toMatchObject({ code: "AUTH" }); });
});
