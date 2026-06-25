/**
 * Recall MCP server — stdio transport.
 *
 * Exposes four tools for coding agents (Claude Code, Cursor, etc.):
 *
 *  - capture_idea      Store a thought / decision from within an agent session.
 *  - recall_ideas      Retrieve relevant past ideas for the current work context.
 *  - list_open_ideas   List unresolved threads, optionally scoped to a repo.
 *  - resolve_idea      Mark an idea as resolved.
 *
 * Usage: `recall mcp` — drop into a Claude Code / Cursor MCP config as stdio.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { v4 as uuidv4 } from "uuid";
import { getDb, insertIdea, resolveIdea, listIdeas } from "../db/index.js";
import { recallIdeas } from "../recall/index.js";
import { getGitContext } from "../git/index.js";
import type { CaptureContext, GitContext, DecisionMetadata } from "../types.js";
import type { RecallContext } from "../types.js";
import { prepareSemanticQuery } from "../embed/semantic.js";

// ─── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "capture_idea",
    description:
      "Store a thought, decision, or context note from the current coding session. " +
      "Call this whenever you (the agent) make a significant architectural choice, " +
      "identify a known limitation, or want to leave a breadcrumb for the next session. " +
      "Repository and branch are auto-detected from the working directory, so you may " +
      "omit context entirely; pass it only to override or attach a file/error.",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The thought or decision to store (plain text, 1–3 sentences).",
        },
        context: {
          type: "object",
          description: "Optional code context. Repo and branch are auto-detected when omitted.",
          properties: {
            repo: { type: "string", description: "Absolute path to the repo root (auto-detected if omitted)." },
            branch: { type: "string", description: "Current git branch (auto-detected if omitted)." },
            file: { type: "string", description: "File path being worked on." },
            error: { type: "string", description: "Error text if this is an error note." },
          },
        },
        decision: {
          type: "object",
          description:
            "Optional structured decision fields. Use these whenever the session contains clear rationale.",
          properties: {
            decision: { type: "string", description: "Concise decision statement." },
            why: { type: "string", description: "Reasoning behind the decision." },
            alternatives: { type: "string", description: "Rejected alternatives and why they were rejected." },
            tradeoffs: { type: "string", description: "Known costs, risks, or compromises." },
            evidence: { type: "string", description: "Observed evidence, PR/comment/source, or error context." },
            outcome: { type: "string", description: "Expected or observed result." },
          },
        },
      },
      required: ["content"],
    },
  },
  {
    name: "recall_ideas",
    description:
      "Retrieve relevant past ideas, decisions, and context notes for the current work. " +
      "Call this at the start of a session to load prior decisions, or when you encounter " +
      "a problem and want to know if it's been seen before.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "What you're looking for (optional). Leave empty to get context-matched ideas.",
        },
        context: {
          type: "object",
          description: "Current work context for boosting relevant results.",
          properties: {
            repo: { type: "string" },
            branch: { type: "string" },
            file: { type: "string" },
          },
        },
        limit: {
          type: "number",
          description: "Maximum number of results (default 5).",
        },
      },
    },
  },
  {
    name: "list_open_ideas",
    description:
      "List all unresolved ideas / open threads. Useful for a session start 'what was I working on?' check.",
    inputSchema: {
      type: "object" as const,
      properties: {
        repo: {
          type: "string",
          description: "Filter to a specific repo path (optional).",
        },
      },
    },
  },
  {
    name: "resolve_idea",
    description: "Mark an idea as resolved once the decision has been implemented or the thread is closed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The idea ID to resolve.",
        },
      },
      required: ["id"],
    },
  },
];

// ─── Tool handlers ────────────────────────────────────────────────────────────

/** Normalise a filesystem path for comparison across OSes and trailing slashes. */
function samePath(a: string, b: string): boolean {
  const n = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return n(a) === n(b);
}

/**
 * Merge agent-supplied context with auto-detected git context.
 *
 * The agent's explicit values always win. Detected branch and commit are only
 * borrowed when they belong to the same repository we are recording — if the
 * agent named a different repo, we must not attach this directory's branch.
 *
 * Exported for testing without touching git or the process cwd.
 */
export function resolveCaptureContext(
  ctx: CaptureContext,
  detected: GitContext
): { repo_path: string | null; branch: string | null; commit_hash: string | null; file_path: string | null; error_text: string | null } {
  const repoMatches =
    !ctx.repo || (detected.repo_path != null && samePath(ctx.repo, detected.repo_path));
  return {
    repo_path: ctx.repo ?? detected.repo_path ?? null,
    branch: ctx.branch ?? (repoMatches ? detected.branch : null) ?? null,
    commit_hash: repoMatches ? detected.commit_hash ?? null : null,
    file_path: ctx.file ?? null,
    error_text: ctx.error ?? null,
  };
}

async function handleCaptureIdea(args: {
  content: string;
  context?: CaptureContext;
  decision?: DecisionMetadata;
}): Promise<string> {
  const db = getDb();
  const id = uuidv4();
  const ctx = args.context ?? {};

  // Auto-detect git context from the working directory. A stdio MCP server is
  // spawned inside the agent's workspace, so process.cwd() is usually the repo
  // the agent is working in. Agent-supplied values still take precedence.
  const detected = await getGitContext();
  const context = resolveCaptureContext(ctx, detected);

  insertIdea(db, { id, content: args.content, source: "mcp", context, decision: args.decision });

  return JSON.stringify({
    id,
    status: "captured",
    repo: context.repo_path,
    branch: context.branch,
    message: context.repo_path
      ? `Idea stored with id ${id} (repo: ${context.repo_path}${context.branch ? `, branch: ${context.branch}` : ""}).`
      : `Idea stored with id ${id} (no git context detected).`,
  });
}

async function handleRecallIdeas(args: {
  query?: string;
  context?: RecallContext;
  limit?: number;
}): Promise<string> {
  const db = getDb();
  const queryEmbedding = args.query?.trim() ? await prepareSemanticQuery(db, args.query) : undefined;
  const results = await recallIdeas(db, {
    query: args.query,
    context: args.context ?? {},
    limit: args.limit ?? 5,
    queryEmbedding,
  });

  if (results.length === 0) {
    return JSON.stringify({ ideas: [], message: "No relevant ideas found." });
  }

  return JSON.stringify({
    ideas: results.map((r) => ({
      id: r.idea.id,
      content: r.idea.content,
      decision: r.idea.decision,
      why: r.idea.why,
      alternatives: r.idea.alternatives,
      tradeoffs: r.idea.tradeoffs,
      evidence: r.idea.evidence,
      outcome: r.idea.outcome,
      status: r.idea.status,
      created_at: r.idea.created_at,
      context: {
        repo: r.idea.context?.repo_path,
        branch: r.idea.context?.branch,
        file: r.idea.context?.file_path,
        commit: r.idea.context?.commit_hash,
      },
      reason: r.reason,
      score: Math.round(r.score * 100) / 100,
    })),
  });
}

async function handleListOpenIdeas(args: { repo?: string }): Promise<string> {
  const db = getDb();
  const ideas = listIdeas(db, { repo: args.repo, onlyOpen: true });

  return JSON.stringify({
    total: ideas.length,
    ideas: ideas.map((i) => ({
      id: i.id,
      content: i.content,
      decision: i.decision,
      why: i.why,
      alternatives: i.alternatives,
      tradeoffs: i.tradeoffs,
      evidence: i.evidence,
      outcome: i.outcome,
      created_at: i.created_at,
      source: i.source,
      context: {
        repo: i.repo_path,
        branch: i.branch,
        file: i.file_path,
      },
    })),
  });
}

async function handleResolveIdea(args: { id: string }): Promise<string> {
  const db = getDb();
  const changed = resolveIdea(db, args.id);
  if (!changed) {
    return JSON.stringify({ error: `Idea ${args.id} not found.` });
  }
  return JSON.stringify({ id: args.id, status: "resolved" });
}

// ─── Server bootstrap ─────────────────────────────────────────────────────────

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: "recall", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = (args ?? {}) as Record<string, unknown>;

    try {
      let result: string;
      switch (name) {
        case "capture_idea":
          result = await handleCaptureIdea(
            input as Parameters<typeof handleCaptureIdea>[0]
          );
          break;
        case "recall_ideas":
          result = await handleRecallIdeas(
            input as Parameters<typeof handleRecallIdeas>[0]
          );
          break;
        case "list_open_ideas":
          result = await handleListOpenIdeas(
            input as Parameters<typeof handleListOpenIdeas>[0]
          );
          break;
        case "resolve_idea":
          result = await handleResolveIdea(
            input as Parameters<typeof handleResolveIdea>[0]
          );
          break;
        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }

      return { content: [{ type: "text", text: result }] };
    } catch (err) {
      return {
        content: [
          { type: "text", text: `Error: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
