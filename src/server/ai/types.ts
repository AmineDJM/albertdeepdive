import type { z } from "zod";

export type ModelTier = "FAST" | "STRONG";

export type ProviderRequest = {
  system: string;
  user: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  /** JSON schema (already made strict-compatible) the provider must conform to. */
  schema: Record<string, unknown>;
  schemaName: string;
  /** Free-form hints for the local provider (service key, input object). */
  hints: { service: string; input: Record<string, unknown> };
};

export type ProviderResponse = {
  raw: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
  cached?: boolean;
};

export interface AiProvider {
  readonly name: "openai" | "local";
  complete(request: ProviderRequest): Promise<ProviderResponse>;
}

export type AiTaskRequest<T> = {
  /** Service name, e.g. "classifier". Used for logging and as prompt template key by default. */
  service: string;
  promptKey?: string;
  /** Variables substituted into the prompt template ({{name}}) and passed to the local provider. */
  input: Record<string, unknown>;
  schema: z.ZodType<T>;
  schemaName: string;
  tier?: ModelTier;
  temperature?: number;
  maxOutputTokens?: number;
  editionId?: string | null;
  entityType?: EntityTypeForAi;
  entityId?: string | null;
  /** When true, an identical input (same prompt version + model) re-uses the last successful output. */
  cacheable?: boolean;
  jobId?: string | null;
};

export type EntityTypeForAi = "EDITION" | "SUBMISSION" | "CLUSTER" | "STORY" | "ARTICLE" | "MEDIA" | "PAGE_PLAN" | "PUBLICATION_VERSION";

export type AiTaskResult<T> = {
  output: T;
  aiJobId: string;
  model: string;
  provider: string;
  cached: boolean;
  usage: { inputTokens: number; outputTokens: number; costCents: number; latencyMs: number };
  confidence: number | null;
};

export class AiOutputError extends Error {
  constructor(
    message: string,
    public readonly raw: unknown,
  ) {
    super(message);
    this.name = "AiOutputError";
  }
}
