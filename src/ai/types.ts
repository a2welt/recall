export type ProviderKind = "ollama" | "openai" | "anthropic";
export type HandoffTarget = "codex" | "claude" | "copilot" | "generic";
export type ArtifactName = "SPEC.md" | "PROMPT.md" | "SKILL.md";

export interface AiProviderConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey?: string;
  apiVersion?: string;
}

export interface AiConfig {
  providers: AiProviderConfig[];
  activeProviderId: string;
}

export interface GeneratedArtifacts {
  files: Partial<Record<ArtifactName, string>>;
  providerId: string;
  providerName: string;
  model: string;
  target: HandoffTarget;
  memoryId: string;
  generatedAt: string;
}

export class AiError extends Error {
  constructor(public code: "LOCKED" | "NOT_CONFIGURED" | "AUTH" | "MODEL" | "TIMEOUT" | "PROVIDER" | "MALFORMED" | "NOT_FOUND" | "INVALID", message: string, public status = 400) {
    super(message);
    this.name = "AiError";
  }
}
