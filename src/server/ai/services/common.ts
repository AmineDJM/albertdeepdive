import { z } from "zod";
import { STORY_TYPES, type StoryTypeValue } from "@/lib/constants";
import { runAiTask } from "../run";
import type { AiTaskResult, EntityTypeForAi, ModelTier } from "../types";

/** Where an AI call belongs (for logging in ai_jobs) and how it may be cached. */
export type AiServiceContext = {
  editionId?: string | null;
  entityType?: EntityTypeForAi;
  entityId?: string | null;
  jobId?: string | null;
  cacheable?: boolean;
  tier?: ModelTier;
};

export const STORY_TYPE_VALUES = STORY_TYPES.map((t) => t.value) as [StoryTypeValue, ...StoryTypeValue[]];
export const storyTypeSchema = z.enum(STORY_TYPE_VALUES);
export const severitySchema = z.enum(["low", "medium", "high"]);
export const warningSeveritySchema = z.enum(["info", "warning", "error"]);
export const factCategorySchema = z.enum(["date", "person", "result", "organisation", "metric", "award", "other"]);
export const factConfidenceSchema = z.enum(["VERIFIED_BY_SUBMISSION", "STATED_BY_CONTRIBUTOR", "INFERRED", "CONFLICTING"]);

export async function runService<T>(args: {
  service: string;
  promptKey?: string;
  schemaName: string;
  schema: z.ZodType<T>;
  input: Record<string, unknown>;
  ctx?: AiServiceContext;
  tier?: ModelTier;
  maxOutputTokens?: number;
}): Promise<AiTaskResult<T>> {
  const ctx = args.ctx ?? {};
  return runAiTask<T>({
    service: args.service,
    promptKey: args.promptKey ?? args.service,
    input: args.input,
    schema: args.schema,
    schemaName: args.schemaName,
    tier: ctx.tier ?? args.tier,
    maxOutputTokens: args.maxOutputTokens,
    editionId: ctx.editionId ?? null,
    entityType: ctx.entityType,
    entityId: ctx.entityId ?? null,
    cacheable: ctx.cacheable,
    jobId: ctx.jobId ?? null,
  });
}

/** Formats a list for a prompt: one line per item. */
export function lines(items: string[]): string {
  return items.length ? items.join("\n") : "—";
}
