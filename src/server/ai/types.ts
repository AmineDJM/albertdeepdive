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
  /**
   * Pictures the task is asking about, alongside its words.
   *
   * A layout cannot be described in a prompt. Reading somebody's newsletter to learn what their
   * title looks like means *looking* at the page — the weight of the masthead, whether the columns
   * are two or three, how much air there is around a headline — and none of that survives being
   * turned into a paragraph first. Providers that cannot see simply ignore them, which is why this
   * is optional rather than a second kind of task.
   */
  images?: TaskImage[];
};

/** One picture sent with a task. Data URLs only: a model must never be handed one of our URLs. */
export type TaskImage = {
  dataUrl: string;
  /** What the picture is, for the prompt to refer to ("page 1", "the cover"). */
  label?: string;
  detail?: "low" | "high" | "auto";
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
  /** The person this is done for. Left out, it is the signed-in person or the job's author. */
  userId?: string | null;
  /** Pictures the task is about. See `ProviderRequest["images"]`. */
  images?: TaskImage[];
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
