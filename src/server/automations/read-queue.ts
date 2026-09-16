/**
 * Read model for the job queue and the AI call log shown on /automations.
 *
 * The queue itself lives in `src/server/jobs/queue.ts` (claim, run, retry, dead-letter); this
 * module only reads it, joining the labels the screen needs. Nothing here mutates a job.
 */
import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";

const n = (value: unknown): number => Number(value ?? 0);

export type JobStatus = (typeof s.jobs.$inferSelect)["status"];

export const ACTIVE_JOB_STATUSES: JobStatus[] = ["RUNNING", "QUEUED"];
export const RETRYABLE_JOB_STATUSES: JobStatus[] = ["FAILED", "DEAD", "CANCELLED"];

export type JobRow = {
  id: string;
  type: string;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  progress: { done: number; total: number; message?: string } | null;
  idempotencyKey: string | null;
  editionId: string | null;
  editionLabel: string | null;
  createdByName: string | null;
  createdAt: Date;
  durationMs: number | null;
};

export type QueueStats = { total: number; running: number; queued: number; succeeded: number; failed: number; dead: number; cancelled: number; dueNow: number; nextRunAt: Date | null; lastFinishedAt: Date | null };

export type JobFilters = { status?: string; type?: string; editionId?: string };

/** Counts per status plus the two timestamps that tell you whether the worker is alive. */
export async function queueStats(): Promise<QueueStats> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      running: sql<number>`count(*) filter (where ${s.jobs.status} = 'RUNNING')`,
      queued: sql<number>`count(*) filter (where ${s.jobs.status} = 'QUEUED')`,
      succeeded: sql<number>`count(*) filter (where ${s.jobs.status} = 'SUCCEEDED')`,
      failed: sql<number>`count(*) filter (where ${s.jobs.status} = 'FAILED')`,
      dead: sql<number>`count(*) filter (where ${s.jobs.status} = 'DEAD')`,
      cancelled: sql<number>`count(*) filter (where ${s.jobs.status} = 'CANCELLED')`,
      dueNow: sql<number>`count(*) filter (where ${s.jobs.status} = 'QUEUED' and ${s.jobs.runAt} <= now())`,
      nextRunAt: sql<Date | null>`min(${s.jobs.runAt}) filter (where ${s.jobs.status} = 'QUEUED')`,
      lastFinishedAt: sql<Date | null>`max(${s.jobs.finishedAt})`,
    })
    .from(s.jobs);
  return {
    total: n(row?.total),
    running: n(row?.running),
    queued: n(row?.queued),
    succeeded: n(row?.succeeded),
    failed: n(row?.failed),
    dead: n(row?.dead),
    cancelled: n(row?.cancelled),
    dueNow: n(row?.dueNow),
    nextRunAt: row?.nextRunAt ? new Date(row.nextRunAt) : null,
    lastFinishedAt: row?.lastFinishedAt ? new Date(row.lastFinishedAt) : null,
  };
}

/** Running and queued jobs first, then the most recent finished ones. */
export async function listJobs(filters: JobFilters = {}, limit = 60): Promise<JobRow[]> {
  const where: SQL[] = [];
  if (filters.status === "active") where.push(inArray(s.jobs.status, ACTIVE_JOB_STATUSES));
  else if (filters.status === "problem") where.push(inArray(s.jobs.status, ["FAILED", "DEAD"]));
  else if (filters.status) where.push(sql`${s.jobs.status}::text = ${filters.status}`);
  if (filters.type) where.push(eq(s.jobs.type, filters.type));
  if (filters.editionId) where.push(eq(s.jobs.editionId, filters.editionId));
  const rows = await db
    .select({ job: s.jobs, editionLabel: s.editions.label, createdByName: s.users.name })
    .from(s.jobs)
    .leftJoin(s.editions, eq(s.editions.id, s.jobs.editionId))
    .leftJoin(s.users, eq(s.users.id, s.jobs.createdById))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(sql`case when ${s.jobs.status} = 'RUNNING' then 0 when ${s.jobs.status} = 'QUEUED' then 1 when ${s.jobs.status} in ('FAILED', 'DEAD') then 2 else 3 end`), desc(sql`coalesce(${s.jobs.finishedAt}, ${s.jobs.startedAt}, ${s.jobs.runAt}, ${s.jobs.createdAt})`))
    .limit(limit);
  return rows.map(({ job, editionLabel, createdByName }) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    priority: job.priority,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lockedBy: job.lockedBy,
    lastError: job.lastError,
    payload: job.payload,
    result: job.result,
    progress: job.progress,
    idempotencyKey: job.idempotencyKey,
    editionId: job.editionId,
    editionLabel,
    createdByName,
    createdAt: job.createdAt,
    durationMs: job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
  }));
}

/** The job types that actually exist in the queue, for the filter. */
export async function jobTypeOptions(): Promise<string[]> {
  const rows = await db.selectDistinct({ type: s.jobs.type }).from(s.jobs).orderBy(asc(s.jobs.type));
  return rows.map((r) => r.type);
}

export type AiJobRow = {
  id: string;
  service: string;
  provider: string;
  model: string;
  status: (typeof s.aiJobs.$inferSelect)["status"];
  promptKey: string | null;
  promptVersion: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costCents: number;
  latencyMs: number | null;
  confidence: number | null;
  cached: boolean;
  attempts: number;
  error: string | null;
  entityType: string | null;
  entityId: string | null;
  editionId: string | null;
  editionLabel: string | null;
  createdAt: Date;
  completedAt: Date | null;
};

export type AiLogFilters = { service?: string; model?: string; status?: string; editionId?: string };
export type AiLogTotals = { calls: number; tokens: number; costCents: number; failed: number; cached: number; avgLatencyMs: number | null };

/** The AI call log: one row per call, most recent first. */
export async function aiJobLog(filters: AiLogFilters = {}, limit = 60): Promise<{ rows: AiJobRow[]; totals: AiLogTotals; services: string[]; models: string[] }> {
  const where: SQL[] = [];
  if (filters.service) where.push(eq(s.aiJobs.service, filters.service));
  if (filters.model) where.push(eq(s.aiJobs.model, filters.model));
  if (filters.status) where.push(sql`${s.aiJobs.status}::text = ${filters.status}`);
  if (filters.editionId) where.push(eq(s.aiJobs.editionId, filters.editionId));
  const scope = where.length ? and(...where) : undefined;

  const [rows, totalsRow, services, models] = await Promise.all([
    db
      .select({ job: s.aiJobs, editionLabel: s.editions.label })
      .from(s.aiJobs)
      .leftJoin(s.editions, eq(s.editions.id, s.aiJobs.editionId))
      .where(scope)
      .orderBy(desc(s.aiJobs.createdAt))
      .limit(limit),
    db
      .select({
        calls: sql<number>`count(*)`,
        tokens: sql<number>`coalesce(sum(coalesce(${s.aiJobs.inputTokens}, 0) + coalesce(${s.aiJobs.outputTokens}, 0)), 0)`,
        costCents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)`,
        failed: sql<number>`count(*) filter (where ${s.aiJobs.status} = 'FAILED')`,
        cached: sql<number>`count(*) filter (where ${s.aiJobs.cached})`,
        avgLatencyMs: sql<number | null>`avg(${s.aiJobs.latencyMs}) filter (where ${s.aiJobs.cached} = false)`,
      })
      .from(s.aiJobs)
      .where(scope),
    db.selectDistinct({ service: s.aiJobs.service }).from(s.aiJobs).orderBy(asc(s.aiJobs.service)),
    db.selectDistinct({ model: s.aiJobs.model }).from(s.aiJobs).orderBy(asc(s.aiJobs.model)),
  ]);
  const totals = totalsRow[0];
  return {
    rows: rows.map(({ job, editionLabel }) => ({
      id: job.id,
      service: job.service,
      provider: job.provider,
      model: job.model,
      status: job.status,
      promptKey: job.promptKey,
      promptVersion: job.promptVersion,
      inputTokens: job.inputTokens,
      outputTokens: job.outputTokens,
      costCents: Number(job.costCents ?? 0),
      latencyMs: job.latencyMs,
      confidence: job.confidence,
      cached: job.cached,
      attempts: job.attempts,
      error: job.error,
      entityType: job.entityType,
      entityId: job.entityId,
      editionId: job.editionId,
      editionLabel,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    })),
    totals: {
      calls: n(totals?.calls),
      tokens: n(totals?.tokens),
      costCents: n(totals?.costCents),
      failed: n(totals?.failed),
      cached: n(totals?.cached),
      avgLatencyMs: totals?.avgLatencyMs === null || totals?.avgLatencyMs === undefined ? null : Math.round(Number(totals.avgLatencyMs)),
    },
    services: services.map((r) => r.service),
    models: models.map((r) => r.model),
  };
}
