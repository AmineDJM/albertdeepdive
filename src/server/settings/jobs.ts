/**
 * Observability: the job queue and the AI trace (`ai_jobs`).
 */
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiJobs, editions, jobs } from "@/server/db/schema";
import { NotFoundError } from "@/lib/action-result";

const JOB_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD", "CANCELLED"] as const;
type JobStatus = (typeof JOB_STATUSES)[number];
const AI_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"] as const;
type AiStatus = (typeof AI_STATUSES)[number];

export type JobFilters = { status?: string; type?: string; editionId?: string; deadLetter?: boolean; q?: string };

export async function listJobs(filters: JobFilters = {}, limit = 150) {
  const where: SQL[] = [];
  if (filters.deadLetter) where.push(inArray(jobs.status, ["DEAD", "FAILED"]));
  else if (filters.status && (JOB_STATUSES as readonly string[]).includes(filters.status)) where.push(eq(jobs.status, filters.status as JobStatus));
  if (filters.type) where.push(eq(jobs.type, filters.type));
  if (filters.editionId) where.push(eq(jobs.editionId, filters.editionId));
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    where.push(or(ilike(jobs.type, like), ilike(jobs.lastError, like), ilike(jobs.idempotencyKey, like))!);
  }
  const rows = await db
    .select({ job: jobs, editionLabel: editions.label })
    .from(jobs)
    .leftJoin(editions, eq(editions.id, jobs.editionId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`case when ${jobs.status} in ('RUNNING', 'QUEUED') then 0 else 1 end`, desc(jobs.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.job, editionLabel: r.editionLabel }));
}

export type JobRow = Awaited<ReturnType<typeof listJobs>>[number];

export async function jobsSummary() {
  const [counts] = await db
    .select({
      queued: sql<number>`count(*) filter (where ${jobs.status} = 'QUEUED')`,
      running: sql<number>`count(*) filter (where ${jobs.status} = 'RUNNING')`,
      succeeded: sql<number>`count(*) filter (where ${jobs.status} = 'SUCCEEDED')`,
      failed: sql<number>`count(*) filter (where ${jobs.status} in ('FAILED', 'DEAD'))`,
      dead: sql<number>`count(*) filter (where ${jobs.status} = 'DEAD')`,
      total: sql<number>`count(*)`,
    })
    .from(jobs);
  const types = await db.selectDistinct({ type: jobs.type }).from(jobs).orderBy(jobs.type);
  return {
    queued: Number(counts?.queued ?? 0),
    running: Number(counts?.running ?? 0),
    succeeded: Number(counts?.succeeded ?? 0),
    failed: Number(counts?.failed ?? 0),
    dead: Number(counts?.dead ?? 0),
    total: Number(counts?.total ?? 0),
    types: types.map((t) => t.type),
  };
}

export type AiTraceFilters = { service?: string; status?: string; editionId?: string; model?: string; q?: string };

export async function listAiJobs(filters: AiTraceFilters = {}, limit = 200) {
  const where: SQL[] = [];
  if (filters.service) where.push(eq(aiJobs.service, filters.service));
  if (filters.status && (AI_STATUSES as readonly string[]).includes(filters.status)) where.push(eq(aiJobs.status, filters.status as AiStatus));
  if (filters.editionId) where.push(eq(aiJobs.editionId, filters.editionId));
  if (filters.model) where.push(eq(aiJobs.model, filters.model));
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    where.push(or(ilike(aiJobs.service, like), ilike(aiJobs.promptKey, like), ilike(aiJobs.error, like), sql`${aiJobs.entityId}::text ilike ${like}`)!);
  }
  const rows = await db
    .select({
      id: aiJobs.id,
      service: aiJobs.service,
      provider: aiJobs.provider,
      model: aiJobs.model,
      promptKey: aiJobs.promptKey,
      promptVersion: aiJobs.promptVersion,
      editionId: aiJobs.editionId,
      editionLabel: editions.label,
      entityType: aiJobs.entityType,
      entityId: aiJobs.entityId,
      status: aiJobs.status,
      latencyMs: aiJobs.latencyMs,
      inputTokens: aiJobs.inputTokens,
      outputTokens: aiJobs.outputTokens,
      costCents: aiJobs.costCents,
      confidence: aiJobs.confidence,
      attempts: aiJobs.attempts,
      cached: aiJobs.cached,
      error: aiJobs.error,
      createdAt: aiJobs.createdAt,
      completedAt: aiJobs.completedAt,
    })
    .from(aiJobs)
    .leftJoin(editions, eq(editions.id, aiJobs.editionId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(aiJobs.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, costCents: r.costCents == null ? 0 : Number(r.costCents) }));
}

export type AiTraceRow = Awaited<ReturnType<typeof listAiJobs>>[number];

export async function aiTraceSummary(filters: Pick<AiTraceFilters, "editionId"> = {}) {
  const where = filters.editionId ? eq(aiJobs.editionId, filters.editionId) : undefined;
  const [stats] = await db
    .select({
      calls: sql<number>`count(*)`,
      costCents: sql<number>`coalesce(sum(${aiJobs.costCents}), 0)`,
      tokens: sql<number>`coalesce(sum(coalesce(${aiJobs.inputTokens}, 0) + coalesce(${aiJobs.outputTokens}, 0)), 0)`,
      failed: sql<number>`count(*) filter (where ${aiJobs.status} = 'FAILED')`,
      cached: sql<number>`count(*) filter (where ${aiJobs.cached})`,
      avgLatencyMs: sql<number | null>`avg(${aiJobs.latencyMs}) filter (where ${aiJobs.cached} = false and ${aiJobs.status} = 'SUCCEEDED')`,
      p95LatencyMs: sql<number | null>`percentile_cont(0.95) within group (order by ${aiJobs.latencyMs}) filter (where ${aiJobs.cached} = false and ${aiJobs.status} = 'SUCCEEDED')`,
    })
    .from(aiJobs)
    .where(where);
  const services = await db.selectDistinct({ service: aiJobs.service }).from(aiJobs).orderBy(aiJobs.service);
  const models = await db.selectDistinct({ model: aiJobs.model }).from(aiJobs).orderBy(aiJobs.model);
  return {
    calls: Number(stats?.calls ?? 0),
    costCents: Number(stats?.costCents ?? 0),
    tokens: Number(stats?.tokens ?? 0),
    failed: Number(stats?.failed ?? 0),
    cached: Number(stats?.cached ?? 0),
    avgLatencyMs: stats?.avgLatencyMs == null ? null : Math.round(Number(stats.avgLatencyMs)),
    p95LatencyMs: stats?.p95LatencyMs == null ? null : Math.round(Number(stats.p95LatencyMs)),
    services: services.map((s) => s.service),
    models: models.map((m) => m.model),
  };
}

export async function getAiJob(id: string) {
  const [row] = await db.select({ job: aiJobs, editionLabel: editions.label }).from(aiJobs).leftJoin(editions, eq(editions.id, aiJobs.editionId)).where(eq(aiJobs.id, id)).limit(1);
  if (!row) throw new NotFoundError("AI job");
  return { ...row.job, costCents: row.job.costCents == null ? 0 : Number(row.job.costCents), editionLabel: row.editionLabel };
}

/** Where an AI job's entity lives in the newsroom (best effort). */
export function entityHref(entityType: string | null, entityId: string | null, editionId: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType) {
    case "SUBMISSION":
      return editionId ? `/editions/${editionId}/inbox/${entityId}` : null;
    case "STORY":
    case "CLUSTER":
    case "BDD":
      return `/stories/${entityId}`;
    case "ARTICLE":
      return `/articles/${entityId}`;
    case "MEDIA":
      return `/media/${entityId}`;
    case "EDITION":
      return `/editions/${entityId}`;
    case "PUBLICATION_VERSION":
    case "PAGE_PLAN":
    case "PAGE":
      return editionId ? `/editions/${editionId}/layout` : null;
    case "CONTRIBUTOR":
      return `/contributors/${entityId}`;
    default:
      return null;
  }
}
