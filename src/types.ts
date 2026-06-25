// ─── Core domain types ────────────────────────────────────────────────────────

export type IdeaSource   = "cli" | "ingested" | "mcp";
export type IdeaStatus   = "open" | "resolved" | "archived";
export type IdeaPriority = "high" | "medium" | "low";
export type IdeaCategory =
  | "decision"
  | "bug"
  | "architecture"
  | "todo"
  | "note"
  | "idea";
export type WorkflowStatus = "backlog" | "active" | "blocked" | "done";

export interface Project {
  id: string;
  name: string;
  color: string;
  status: "active" | "paused" | "completed";
  created_at: string;
  updated_at: string;
}

export interface Idea {
  id: string;
  content: string;
  decision: string | null;
  why: string | null;
  alternatives: string | null;
  tradeoffs: string | null;
  evidence: string | null;
  outcome: string | null;
  created_at: string; // ISO 8601
  updated_at: string;
  source: IdeaSource;
  source_path: string | null;
  status: IdeaStatus;
  priority: IdeaPriority;
  category: IdeaCategory;
  topic: string;
  project_id: string | null;
  workflow_status: WorkflowStatus;
}

export interface IdeaContext {
  idea_id: string;
  repo_path: string | null;
  branch: string | null;
  file_path: string | null;
  line_start: number | null;
  line_end: number | null;
  commit_hash: string | null;
  error_text: string | null;
}

export interface IdeaWithContext extends Idea {
  context: IdeaContext | null;
}

// ─── Git context ──────────────────────────────────────────────────────────────

export interface GitContext {
  repo_path: string | null;
  branch: string | null;
  commit_hash: string | null;
}

// ─── Recall results ───────────────────────────────────────────────────────────

export interface RecalledIdea {
  idea: IdeaWithContext;
  score: number;
  reason: string;
}

// ─── Ingest stats ─────────────────────────────────────────────────────────────

export interface IngestStats {
  added: number;
  skipped: number;
  errors: number;
}

// ─── MCP capture context ──────────────────────────────────────────────────────

export interface CaptureContext {
  repo?: string;
  branch?: string;
  file?: string;
  error?: string;
}

export interface DecisionMetadata {
  decision?: string | null;
  why?: string | null;
  alternatives?: string | null;
  tradeoffs?: string | null;
  evidence?: string | null;
  outcome?: string | null;
}

export interface RecallContext {
  repo?: string;
  branch?: string;
  file?: string;
}
