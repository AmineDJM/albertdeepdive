/**
 * Job handlers of the editorial module (registered when src/server/jobs/handlers/index.ts loads).
 */
import { registerJobHandler, JOB_TYPES } from "@/server/jobs/registry";
import { processEdition, processNewSubmissions } from "@/server/ai/pipeline";
import { draftArticle } from "./articles";
import { processSubmission } from "./submissions";

registerJobHandler<{ submissionId: string; force?: boolean }, Record<string, unknown>>(JOB_TYPES.SUBMISSION_PROCESS, async (payload, ctx) => {
  const result = await processSubmission(payload.submissionId, { force: !!payload.force, jobId: ctx.job.id });
  return { ...result };
});

registerJobHandler<{ editionId: string; force?: boolean; incremental?: boolean; userId?: string | null }, Record<string, unknown>>(JOB_TYPES.EDITION_PROCESS, async (payload, ctx) => {
  if (payload.incremental) {
    const result = await processNewSubmissions(payload.editionId, { jobCtx: ctx, jobId: ctx.job.id });
    return { ...result };
  }
  const summary = await processEdition(payload.editionId, { jobCtx: ctx, triggeredBy: payload.userId ? "MANUAL" : "SCHEDULER", force: !!payload.force, jobId: ctx.job.id, userId: payload.userId ?? null });
  return { ...summary, clustering: summary.clustering ? { groups: summary.clustering.groups, created: summary.clustering.created.length } : null };
});

registerJobHandler<{ storyId: string; userId?: string | null; instruction?: string | null }, Record<string, unknown>>(JOB_TYPES.STORY_DRAFT, async (payload, ctx) => {
  const result = await draftArticle(payload.storyId, { userId: payload.userId ?? null, instruction: payload.instruction ?? null, jobCtx: ctx, jobId: ctx.job.id });
  return { articleId: result.article.id, version: result.revision.version, wordCount: result.article.wordCount, cautions: result.cautions, aiJobIds: result.aiJobIds, costCents: result.costCents };
});
