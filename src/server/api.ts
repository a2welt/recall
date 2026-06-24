import type { IncomingMessage, ServerResponse } from "node:http";
import { getDb, insertIdea, resolveIdea, listIdeas, getRecentIdeas, listProjects, createProject, updateProjectStatus, updateIdeaWorkflow, assignIdeaProject, deleteIdea } from "../db/index.js";
import { recallIdeas } from "../recall/index.js";
import { getGitContext } from "../git/index.js";
import { v4 as uuidv4 } from "uuid";
import type { IdeaPriority, IdeaCategory, Project, WorkflowStatus } from "../types.js";
import { inferTopic } from "../topic.js";
import { getAiConfig, isAiConfigured, isAiUnlocked, lockAiConfig, redactedConfig, saveAiConfig, unlockAiConfig, providerById, updateAiConfig } from "../ai/config.js";
import { generateArtifacts } from "../ai/generate.js";
import { testProvider } from "../ai/providers.js";
import { createZip } from "../ai/zip.js";
import type { AiConfig, ArtifactName, HandoffTarget } from "../ai/types.js";
import { AiError } from "../ai/types.js";
import { getMobileSyncConfig, pullMobileCaptures, redactedMobileConfig, setupMobileSync } from "../mobile/sync.js";

type Handler = (req: IncomingMessage, res: ServerResponse, body: unknown) => Promise<void>;

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

function err(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; if (raw.length > 2_000_000) { reject(new Error("Request body too large")); req.destroy(); } });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

const routes: Record<string, Record<string, Handler>> = {
  "/api/ideas": {
    GET: async (_req, res) => {
      json(res, 200, listIdeas(getDb()));
    },
    POST: async (_req, res, body) => {
      const { content, file, priority, category, topic, project_id, workflow_status } = body as {
        content: string; file?: string;
        priority?: string; category?: string; topic?: string; project_id?: string | null; workflow_status?: string;
      };
      if (!content?.trim()) return err(res, 400, "content is required");
      const db = getDb();
      const id = uuidv4();
      insertIdea(db, {
        id, content, source: "cli",
        priority: (priority as IdeaPriority) || "medium",
        category: (category as IdeaCategory) || "note",
        topic: topic?.trim() || inferTopic(content),
        project_id: project_id || null,
        workflow_status: (workflow_status as WorkflowStatus) || "backlog",
        // Dashboard captures are general memories unless the user explicitly
        // supplies a file. The server's own cwd is not the memory's context.
        context: { file_path: file ?? null },
      });
      json(res, 201, { id, content, status: "open", priority: priority || "medium", category: category || "note", topic: topic?.trim() || inferTopic(content), project_id: project_id || null, workflow_status: workflow_status || "backlog" });
    },
  },

  "/api/recall": {
    POST: async (_req, res, body) => {
      const { query, repo, branch, file, limit } = body as {
        query?: string; repo?: string; branch?: string; file?: string; limit?: number;
      };
      const results = await recallIdeas(getDb(), {
        query, context: { repo, branch, file }, limit: limit ?? 10,
      });
      json(res, 200, results.map((r) => ({
        id: r.idea.id,
        content: r.idea.content,
        status: r.idea.status,
        priority: r.idea.priority,
        category: r.idea.category,
        topic: r.idea.topic,
        project_id: r.idea.project_id,
        workflow_status: r.idea.workflow_status,
        source: r.idea.source,
        created_at: r.idea.created_at,
        context: r.idea.context,
        reason: r.reason,
        score: Math.round(r.score * 100) / 100,
      })));
    },
  },

  "/api/digest": {
    GET: async (_req, res) => {
      const db = getDb();
      const gitCtx = await getGitContext();
      const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const recent = getRecentIdeas(db, 20, gitCtx.repo_path ?? undefined)
        .filter((r) => r.created_at >= cutoff);
      const resurfaced = await recallIdeas(db, {
        context: { repo: gitCtx.repo_path ?? undefined, branch: gitCtx.branch ?? undefined },
        limit: 5,
      });
      json(res, 200, {
        repo: gitCtx.repo_path,
        branch: gitCtx.branch,
        recent,
        resurfaced: resurfaced.map((r) => ({ ...r.idea, reason: r.reason, score: r.score })),
      });
    },
  },

  "/api/ideas/:id/resolve": {
    POST: async (req, res) => {
      const id = (req as IncomingMessage & { _params?: Record<string, string> })._params?.id ?? "";
      const changed = resolveIdea(getDb(), id);
      if (!changed) return err(res, 404, `Idea ${id} not found`);
      json(res, 200, { id, status: "resolved" });
    },
  },

  "/api/context": {
    GET: async (_req, res) => {
      json(res, 200, await getGitContext());
    },
  },
  "/api/projects": {
    GET: async (_req, res) => json(res, 200, listProjects(getDb())),
    POST: async (_req, res, body) => {
      const { name, color } = body as { name?: string; color?: string };
      if (!name?.trim()) return err(res, 400, "name is required");
      json(res, 201, createProject(getDb(), { id: uuidv4(), name: name.trim(), color: color || "#6674ef" }));
    },
  },
  "/api/projects/:id/status": {
    POST: async (req, res, body) => {
      const id = (req as IncomingMessage & { _params?: Record<string, string> })._params?.id ?? "";
      const { status } = body as { status?: Project["status"] };
      if (!status || !["active", "paused", "completed"].includes(status)) return err(res, 400, "invalid project status");
      if (!updateProjectStatus(getDb(), id, status)) return err(res, 404, "project not found");
      json(res, 200, { id, status });
    },
  },
  "/api/ideas/:id/workflow": {
    POST: async (req, res, body) => {
      const id = (req as IncomingMessage & { _params?: Record<string, string> })._params?.id ?? "";
      const { status } = body as { status?: WorkflowStatus };
      if (!status || !["backlog", "active", "blocked", "done"].includes(status)) return err(res, 400, "invalid workflow status");
      if (!updateIdeaWorkflow(getDb(), id, status)) return err(res, 404, "memory not found");
      json(res, 200, { id, workflow_status: status });
    },
  },
  "/api/ideas/:id/project": {
    POST: async (req, res, body) => {
      const id = (req as IncomingMessage & { _params?: Record<string, string> })._params?.id ?? "";
      const { project_id } = body as { project_id?: string | null };
      if (!assignIdeaProject(getDb(), id, project_id || null)) return err(res, 404, "memory not found");
      json(res, 200, { id, project_id: project_id || null });
    },
  },
  "/api/ideas/:id": {
    DELETE: async (req, res) => {
      const id = (req as IncomingMessage & { _params?: Record<string, string> })._params?.id ?? "";
      if (!deleteIdea(getDb(), id)) return err(res, 404, "memory not found");
      json(res, 200, { id, deleted: true });
    },
  },
  "/api/ai/config": {
    GET: async (_req, res) => json(res, 200, { configured: await isAiConfigured(), unlocked: isAiUnlocked(), config: isAiUnlocked() ? redactedConfig(getAiConfig()) : null }),
    POST: async (_req, res, body) => {
      const { config, passphrase } = body as { config?: AiConfig; passphrase?: string };
      if (!config || !passphrase) return err(res, 400, "config and passphrase are required");
      const existing = isAiUnlocked() ? getAiConfig() : null;
      const merged: AiConfig = { ...config, providers: config.providers.map((provider) => ({ ...provider, apiKey: provider.apiKey === "••••••••" ? existing?.providers.find((item) => item.id === provider.id)?.apiKey : provider.apiKey })) };
      await saveAiConfig(merged, passphrase); json(res, 200, { configured: true, unlocked: true, config: redactedConfig(merged) });
    },
  },
  "/api/ai/unlock": {
    POST: async (_req, res, body) => { const { passphrase } = body as { passphrase?: string }; if (!passphrase) return err(res, 400, "passphrase is required"); json(res, 200, { configured: true, unlocked: true, config: redactedConfig(await unlockAiConfig(passphrase)) }); },
  },
  "/api/ai/config/update": {
    POST: async (_req, res, body) => {
      const { config } = body as { config?: AiConfig }; if (!config) return err(res, 400, "config is required");
      const existing = getAiConfig(); const merged: AiConfig = { ...config, providers: config.providers.map((provider) => ({ ...provider, apiKey: provider.apiKey === "••••••••" ? existing.providers.find((item) => item.id === provider.id)?.apiKey : provider.apiKey })) };
      await updateAiConfig(merged); json(res, 200, { configured: true, unlocked: true, config: redactedConfig(merged) });
    },
  },
  "/api/ai/lock": { POST: async (_req, res) => { lockAiConfig(); json(res, 200, { unlocked: false }); } },
  "/api/ai/test": {
    POST: async (_req, res, body) => { const { provider_id } = body as { provider_id?: string }; json(res, 200, await testProvider(providerById(provider_id))); },
  },
  "/api/handoffs/generate": {
    POST: async (req, res, body) => {
      const input = body as { memory_id?: string; provider_id?: string; target?: HandoffTarget; artifacts?: ArtifactName[]; instructions?: string };
      if (!input.memory_id || !input.target || !input.artifacts) return err(res, 400, "memory_id, target, and artifacts are required");
      const controller = new AbortController(); res.once("close", () => { if (!res.writableEnded) controller.abort(); });
      json(res, 200, await generateArtifacts(getDb(), { memoryId: input.memory_id, providerId: input.provider_id, target: input.target, artifacts: input.artifacts, instructions: input.instructions, signal: controller.signal }));
    },
  },
  "/api/handoffs/export": {
    POST: async (_req, res, body) => {
      const input = body as { files?: Record<string, string>; manifest?: Record<string, unknown> };
      const allowed = new Set(["SPEC.md", "PROMPT.md", "SKILL.md"]); const files = Object.fromEntries(Object.entries(input.files ?? {}).filter(([name, content]) => allowed.has(name) && typeof content === "string"));
      if (!Object.keys(files).length) return err(res, 400, "No valid artifacts supplied");
      const zip = createZip({ ...files, "manifest.json": JSON.stringify(input.manifest ?? {}, null, 2) });
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=recall-handoff.zip", "Content-Length": zip.length, "Cache-Control": "no-store" }); res.end(zip);
    },
  },
  "/api/mobile/config": {
    GET: async (_req, res) => json(res, 200, redactedMobileConfig(await getMobileSyncConfig())),
    POST: async (_req, res, body) => { const { worker_url, pages_url } = body as { worker_url?: string; pages_url?: string }; if (!worker_url || !pages_url) return err(res, 400, "worker_url and pages_url are required"); const result = await setupMobileSync(worker_url, pages_url); json(res, 201, redactedMobileConfig(result.config)); },
  },
  "/api/mobile/sync": { POST: async (_req, res) => json(res, 200, await pullMobileCaptures()) },
};

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const url = req.url ?? "/";
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return true;
  }

  let handler = routes[url]?.[method];
  let params: Record<string, string> = {};

  if (!handler) {
    const m = url.match(/^\/api\/ideas\/([^/]+)\/resolve$/);
    if (m) { handler = routes["/api/ideas/:id/resolve"]?.[method]; params = { id: m[1] }; }
  }
  if (!handler) {
    const patterns: Array<[RegExp, string]> = [
      [/^\/api\/projects\/([^/]+)\/status$/, "/api/projects/:id/status"],
      [/^\/api\/ideas\/([^/]+)\/workflow$/, "/api/ideas/:id/workflow"],
      [/^\/api\/ideas\/([^/]+)\/project$/, "/api/ideas/:id/project"],
      [/^\/api\/ideas\/([^/]+)$/, "/api/ideas/:id"],
    ];
    for (const [pattern, route] of patterns) {
      const match = url.match(pattern);
      if (match) { handler = routes[route]?.[method]; params = { id: match[1] }; break; }
    }
  }

  if (!handler) return false;

  (req as IncomingMessage & { _params?: Record<string, string> })._params = params;

  try {
    const body = method === "POST" ? await readBody(req) : {};
    await handler(req, res, body);
  } catch (e) {
    if (e instanceof AiError) err(res, e.status, `${e.code}: ${e.message}`);
    else err(res, 500, (e as Error).message);
  }
  return true;
}
