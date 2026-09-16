/**
 * Edition-level AI pipeline: process submissions → cluster → create stories → section plan →
 * notifications. Guarded by an automation_runs row keyed `${editionId}:AI_PROCESSING` so re-runs are
 * idempotent and visible in the control room.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { automationRuns, campuses, editionSections, editions, facts, stories, storyClusters, submissionCampuses, submissions } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import type { JobContext } from "@/server/jobs/registry";
import { clusterEdition, type ClusterEditionResult } from "@/server/editorial/clustering";
import { notifyRole } from "@/server/editorial/notifications";
import { createStoriesForEdition } from "@/server/editorial/stories";
import { listUnprocessedSubmissionIds, processSubmission } from "@/server/editorial/submissions";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { assertTransition, type EditionStatus } from "@/lib/editorial/edition-state";
import { planSections, type AiServiceContext } from "./services";

const log = createLogger("ai:pipeline");

export type ProcessEditionSummary = {
  editionId: string;
  status: EditionStatus;
  submissionsProcessed: number;
  submissionsSkipped: number;
  submissionsFailed: string[];
  clustering: ClusterEditionResult | null;
  storiesCreated: number;
  sectionPlan: { planned: number; coverStoryId: string | null; spotlightStoryIds: string[] } | null;
  notifications: { processingCompleted: number; factualConflict: number; lowCampusCoverage: string[] };
  aiCostCents: number;
  durationMs: number;
};

type Progress = Pick<JobContext, "progress" | "log"> | null | undefined;

const STALE_RUN_MS = 30 * 60 * 1000;

async function startRun(editionId: string, triggeredBy: string, jobId: string | null, force: boolean) {
  const runKey = `${editionId}:AI_PROCESSING`;
  const existing = await db.query.automationRuns.findFirst({ where: eq(automationRuns.runKey, runKey) });
  if (existing?.status === "RUNNING" && existing.startedAt && Date.now() - existing.startedAt.getTime() < STALE_RUN_MS && !force) {
    throw new ValidationError("AI processing is already running for this edition");
  }
  const [row] = await db
    .insert(automationRuns)
    .values({ editionId, step: "AI_PROCESSING", runKey, status: "RUNNING", triggeredBy, startedAt: new Date(), finishedAt: null, summary: {}, error: null, jobId })
    .onConflictDoUpdate({ target: automationRuns.runKey, set: { status: "RUNNING", triggeredBy, startedAt: new Date(), finishedAt: null, summary: {}, error: null, jobId } })
    .returning();
  return row;
}

async function finishRun(runId: string, status: "SUCCEEDED" | "FAILED", summary: Record<string, unknown>, error?: string) {
  await db.update(automationRuns).set({ status, finishedAt: new Date(), summary, error: error ?? null }).where(eq(automationRuns.id, runId));
}

/** Applies the section planner's suggestions without overriding editorial decisions. */
async function applySectionPlan(editionId: string, ctx: AiServiceContext, edition: { targetPageCount: number }) {
  const sectionRows = await db.query.editionSections.findMany({ where: and(eq(editionSections.editionId, editionId), eq(editionSections.isHidden, false)), orderBy: [asc(editionSections.sortOrder)] });
  const storyRows = await db.query.stories.findMany({
    where: and(eq(stories.editionId, editionId), inArray(stories.status, ["CANDIDATE", "SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED"])),
    with: { section: { columns: { slug: true } }, campuses: { with: { campus: { columns: { name: true } } } }, media: { columns: { role: true } }, article: { columns: { wordCount: true } }, cluster: { columns: { id: true } } },
  });
  if (!storyRows.length) return null;
  const wordsOf = (s: (typeof storyRows)[number]) => s.article?.wordCount || 0;
  const plan = await planSections(
    {
      sections: sectionRows.map((s) => ({ slug: s.slug, name: s.name })),
      stories: storyRows.map((s) => ({ id: s.id, title: s.title, storyType: s.storyType, campuses: s.campuses.map((c) => c.campus.name), score: s.editorialScore ?? Math.round(s.aiScores.total ?? 50), words: wordsOf(s), photos: s.media.length, hasHero: s.media.some((m) => m.role === "hero"), targetLength: s.targetLength, currentSectionSlug: s.section?.slug ?? null })),
      targetPages: edition.targetPageCount,
    },
    ctx,
  );
  const sectionBySlug = new Map(sectionRows.map((s) => [s.slug, s]));
  const byId = new Map(storyRows.map((s) => [s.id, s]));
  let planned = 0;
  for (const p of plan.output.stories) {
    const story = byId.get(p.storyId);
    const section = sectionBySlug.get(p.sectionSlug);
    if (!story) continue;
    planned += 1;
    const notes = story.aiNotes.filter((n) => !n.startsWith("Section planner:"));
    notes.push(`Section planner: ${section ? section.name : p.sectionSlug}, position ${p.order}, ${p.template}, ${p.pages} page(s)${p.storyId === plan.output.coverStoryId ? " — suggested cover story" : ""}${plan.output.spotlightStoryIds.includes(p.storyId) ? " — suggested spotlight" : ""}.`);
    await db
      .update(stories)
      .set({ suggestedTemplate: p.template, aiNotes: notes, ...(story.sectionId === null && section ? { sectionId: section.id } : {}) })
      .where(eq(stories.id, p.storyId));
    if (story.cluster?.id && section) await db.update(storyClusters).set({ suggestedSectionSlug: p.sectionSlug }).where(eq(storyClusters.id, story.cluster.id));
  }
  return { planned, coverStoryId: plan.output.coverStoryId, spotlightStoryIds: plan.output.spotlightStoryIds, rationale: plan.output.rationale };
}

async function campusCoverage(editionId: string): Promise<string[]> {
  const active = await db.query.campuses.findMany({ where: eq(campuses.isActive, true) });
  if (active.length < 2) return [];
  const counts = await db
    .select({ campusId: submissionCampuses.campusId, n: sql<number>`count(*)::int` })
    .from(submissionCampuses)
    .innerJoin(submissions, eq(submissions.id, submissionCampuses.submissionId))
    .where(and(eq(submissions.editionId, editionId), sql`${submissions.status} not in ('REJECTED', 'ARCHIVED', 'DRAFT')`))
    .groupBy(submissionCampuses.campusId);
  const byCampus = new Map(counts.map((c) => [c.campusId, Number(c.n)]));
  const total = [...byCampus.values()].reduce((a, b) => a + b, 0);
  if (total < 5) return [];
  const average = total / active.length;
  return active.filter((c) => (byCampus.get(c.id) ?? 0) < 0.2 * average).map((c) => c.name);
}

/**
 * Runs the whole AI processing of an edition. Safe to re-run: processed submissions are skipped,
 * clusters are reused, stories are created only once.
 */
export async function processEdition(editionId: string, opts: { jobCtx?: Progress; triggeredBy?: string; force?: boolean; jobId?: string | null; userId?: string | null } = {}): Promise<ProcessEditionSummary> {
  const started = Date.now();
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const run = await startRun(editionId, opts.triggeredBy ?? "MANUAL", opts.jobId ?? null, !!opts.force);
  const summary: ProcessEditionSummary = { editionId, status: edition.status, submissionsProcessed: 0, submissionsSkipped: 0, submissionsFailed: [], clustering: null, storiesCreated: 0, sectionPlan: null, notifications: { processingCompleted: 0, factualConflict: 0, lowCampusCoverage: [] }, aiCostCents: 0, durationMs: 0 };
  const ctx: AiServiceContext = { editionId, entityType: "EDITION", entityId: editionId, jobId: opts.jobId ?? null };
  let transitioned = false;
  try {
    if (edition.status !== "PROCESSING" && edition.status !== "EDITORIAL_REVIEW") {
      assertTransition(edition.status, "PROCESSING");
      await db.update(editions).set({ status: "PROCESSING" }).where(eq(editions.id, editionId));
      transitioned = true;
      summary.status = "PROCESSING";
    }

    const ids = opts.force
      ? (await db.select({ id: submissions.id }).from(submissions).where(and(eq(submissions.editionId, editionId), sql`${submissions.status} <> 'DRAFT'`)).orderBy(asc(submissions.createdAt))).map((r) => r.id)
      : await listUnprocessedSubmissionIds(editionId);
    for (const [i, id] of ids.entries()) {
      try {
        const r = await processSubmission(id, { force: !!opts.force, jobId: opts.jobId ?? null });
        if (r.skipped) summary.submissionsSkipped += 1;
        else summary.submissionsProcessed += 1;
        summary.aiCostCents += r.costCents;
      } catch (err) {
        summary.submissionsFailed.push(id);
        log.error("submission processing failed", { submissionId: id, err });
      }
      await opts.jobCtx?.progress?.(i + 1, ids.length, `Submissions: ${i + 1}/${ids.length}`);
    }

    summary.clustering = await clusterEdition(editionId, { jobCtx: opts.jobCtx, jobId: opts.jobId ?? null });
    const created = await createStoriesForEdition(editionId, { userId: opts.userId ?? null });
    summary.storiesCreated = created.created.length;
    summary.sectionPlan = await applySectionPlan(editionId, ctx, edition);

    const [disputed] = await db.select({ n: sql<number>`count(*)::int` }).from(facts).where(and(eq(facts.editionId, editionId), eq(facts.status, "DISPUTED")));
    const disputedCount = Number(disputed?.n ?? 0);
    const [storyCount] = await db.select({ n: sql<number>`count(*)::int` }).from(stories).where(eq(stories.editionId, editionId));
    const roles = ["EDITOR", "EDITOR_IN_CHIEF", "SUPER_ADMIN"] as const;
    summary.notifications.processingCompleted = await notifyRole([...roles], { type: "PROCESSING_COMPLETED", title: `AI processing finished for ${edition.label}`, body: `${summary.submissionsProcessed} submission(s) processed, ${summary.clustering.groups} cluster(s), ${summary.storiesCreated} new stor${summary.storiesCreated === 1 ? "y" : "ies"} (${Number(storyCount?.n ?? 0)} in total).`, entityType: "EDITION", entityId: editionId, href: `/editions/${editionId}` });
    if (disputedCount > 0) {
      summary.notifications.factualConflict = await notifyRole([...roles], { type: "FACTUAL_CONFLICT", title: `${disputedCount} disputed fact(s) in ${edition.label}`, body: "Conflicting names or figures were found between submissions. Resolve them before approving the articles.", entityType: "EDITION", entityId: editionId, href: `/editions/${editionId}/stories?flag=disputed` });
    }
    const low = await campusCoverage(editionId);
    if (low.length) {
      await notifyRole([...roles], { type: "LOW_CAMPUS_COVERAGE", title: `${low.join(", ")} under-represented in ${edition.label}`, body: "These campuses have fewer than 20% of the average number of submissions. Consider requesting contributions from their ambassadors.", entityType: "EDITION", entityId: editionId, href: `/editions/${editionId}/inbox` });
      summary.notifications.lowCampusCoverage = low;
    }

    const current = await db.query.editions.findFirst({ where: eq(editions.id, editionId), columns: { status: true } });
    if (current?.status === "PROCESSING") {
      assertTransition("PROCESSING", "EDITORIAL_REVIEW");
      await db.update(editions).set({ status: "EDITORIAL_REVIEW" }).where(eq(editions.id, editionId));
      summary.status = "EDITORIAL_REVIEW";
    } else if (current) summary.status = current.status;
    summary.durationMs = Date.now() - started;
    await finishRun(run.id, "SUCCEEDED", { ...summary, clustering: summary.clustering ? { groups: summary.clustering.groups, created: summary.clustering.created.length, updated: summary.clustering.updated.length, dismissed: summary.clustering.dismissed.length } : null });
    await audit({ action: "edition.process", actorType: opts.userId ? "USER" : "AI", userId: opts.userId ?? null, entityType: "EDITION", entityId: editionId, editionId, metadata: { submissionsProcessed: summary.submissionsProcessed, storiesCreated: summary.storiesCreated, durationMs: summary.durationMs, aiCostCents: summary.aiCostCents } });
    log.info("edition processed", { editionId, submissionsProcessed: summary.submissionsProcessed, storiesCreated: summary.storiesCreated, durationMs: summary.durationMs });
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishRun(run.id, "FAILED", { ...summary, clustering: null }, message);
    if (transitioned) await db.update(editions).set({ status: "CLOSED" }).where(and(eq(editions.id, editionId), eq(editions.status, "PROCESSING")));
    log.error("edition processing failed", { editionId, err });
    throw err;
  }
}

/** Incremental processing while a campaign is open: normalise/classify/dedupe new submissions only. */
export async function processNewSubmissions(editionId: string, opts: { jobCtx?: Progress; jobId?: string | null } = {}): Promise<{ processed: number; failed: string[]; aiCostCents: number }> {
  const ids = await listUnprocessedSubmissionIds(editionId);
  const result = { processed: 0, failed: [] as string[], aiCostCents: 0 };
  for (const [i, id] of ids.entries()) {
    try {
      const r = await processSubmission(id, { jobId: opts.jobId ?? null });
      if (!r.skipped) result.processed += 1;
      result.aiCostCents += r.costCents;
    } catch (err) {
      result.failed.push(id);
      log.error("submission processing failed", { submissionId: id, err });
    }
    await opts.jobCtx?.progress?.(i + 1, ids.length, `Submissions: ${i + 1}/${ids.length}`);
  }
  return result;
}

