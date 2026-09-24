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

/**
 * A document's parts, turned into topics: each part read like any contribution, then grouped with
 * everything else the edition has, and a topic proposed for each group.
 */
registerJobHandler<{ editionId: string; submissionIds: string[]; userId?: string | null }, Record<string, unknown>>(JOB_TYPES.TOPICS_FROM_DOCUMENT, async (payload, ctx) => {
  let processed = 0;
  for (const [index, id] of payload.submissionIds.entries()) {
    try {
      await processSubmission(id, { jobId: ctx.job.id });
      processed += 1;
    } catch (err) {
      ctx.log("a part of the document could not be read", { submissionId: id, err: err instanceof Error ? err.message : String(err) });
    }
    await ctx.progress(index + 1, payload.submissionIds.length + 1, `Reading part ${index + 1} of ${payload.submissionIds.length}`);
  }
  const { clusterEdition } = await import("./clustering");
  const { createStoriesForEdition } = await import("./stories");
  const clustering = await clusterEdition(payload.editionId, { jobCtx: ctx, jobId: ctx.job.id });
  const stories = await createStoriesForEdition(payload.editionId, { userId: payload.userId ?? null });
  await ctx.progress(payload.submissionIds.length + 1, payload.submissionIds.length + 1, "Topics ready");
  return { processed, groups: clustering.groups, topicsCreated: stories.created.length };
});
