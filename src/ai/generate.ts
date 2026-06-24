import { basename, relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getIdeaById, listIdeas, listProjects } from "../db/index.js";
import { providerById } from "./config.js";
import { generateWithProvider } from "./providers.js";
import type { ArtifactName, GeneratedArtifacts, HandoffTarget } from "./types.js";
import { AiError } from "./types.js";
import { buildArtifactMessages, parseArtifacts } from "./artifacts.js";

const ALLOWED: ArtifactName[] = ["SPEC.md", "PROMPT.md", "SKILL.md"];

export interface GenerateRequest { memoryId: string; providerId?: string; target: HandoffTarget; artifacts: ArtifactName[]; instructions?: string; signal?: AbortSignal }

export async function generateArtifacts(db: DatabaseSync, request: GenerateRequest): Promise<GeneratedArtifacts> {
  if (!request.artifacts.length || request.artifacts.some((item) => !ALLOWED.includes(item))) throw new AiError("INVALID", "Select at least one valid artifact type.");
  if (!["codex", "claude", "copilot", "generic"].includes(request.target)) throw new AiError("INVALID", "Invalid target tool.");
  const idea = resolveMemory(db, request.memoryId); const provider = providerById(request.providerId);
  const project = idea.project_id ? listProjects(db).find((item) => item.id === idea.project_id)?.name : undefined;
  const repoName = idea.repo_path ? basename(idea.repo_path) : undefined;
  const file = idea.file_path ? (idea.repo_path ? relative(idea.repo_path, idea.file_path) : basename(idea.file_path)) : undefined;
  const safeContext = { memory_id: idea.id, content: idea.content, topic: idea.topic, category: idea.category, priority: idea.priority, lifecycle: idea.workflow_status, project: project ?? "Inbox", repository: repoName, branch: idea.branch, file, error: idea.error_text };
  const { system, user } = buildArtifactMessages(request.target, request.artifacts, safeContext, request.instructions);
  let files: Partial<Record<ArtifactName, string>>;
  try {
    const raw = await generateWithProvider(provider, system, user, request.signal); files = parseArtifacts(raw, request.artifacts);
  } catch (error) {
    if (!(error instanceof AiError) || error.code !== "MALFORMED") throw error;
    files = {};
    for (const artifact of request.artifacts) {
      const retryMessages = buildArtifactMessages(request.target, [artifact], safeContext, `${request.instructions?.trim() || ""}\nReturn exactly one JSON property named ${artifact}. Do not wrap the JSON in Markdown fences.`);
      let raw = await generateWithProvider(provider, retryMessages.system, retryMessages.user, request.signal);
      try { Object.assign(files, parseArtifacts(raw, [artifact])); }
      catch (retryError) {
        if (!(retryError instanceof AiError) || retryError.code !== "MALFORMED") throw retryError;
        raw = await generateWithProvider(provider, `${retryMessages.system}\nYour previous response was invalid. Output valid JSON only.`, retryMessages.user, request.signal);
        Object.assign(files, parseArtifacts(raw, [artifact]));
      }
    }
  }
  return { files, providerId: provider.id, providerName: provider.name, model: provider.model, target: request.target, memoryId: idea.id, generatedAt: new Date().toISOString() };
}

function resolveMemory(db: DatabaseSync, idOrPrefix: string) {
  const exact = getIdeaById(db, idOrPrefix); if (exact) return exact;
  const matches = listIdeas(db).filter((idea) => idea.id.startsWith(idOrPrefix));
  if (!matches.length) throw new AiError("NOT_FOUND", "Memory not found.", 404);
  if (matches.length > 1) throw new AiError("INVALID", "Memory ID prefix is ambiguous."); return matches[0];
}
