import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { createLogger } from "@/server/logger";
import { getJobHandler, type JobRecord } from "./registry";

const log = createLogger("jobs");

export type EnqueueOptions = {
  type: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  editionId?: string | null;
  createdById?: string | null;
};

export async function enqueueJob(options: EnqueueOptions): Promise<JobRecord> {
  const values = {
    type: options.type,
    payload: options.payload ?? {},
    idempotencyKey: options.idempotencyKey ?? null,
    runAt: options.runAt ?? new Date(),
    priority: options.priority ?? 5,
    maxAttempts: options.maxAttempts ?? 3,
    editionId: options.editionId ?? null,
    createdById: options.createdById ?? null,
  };
  if (values.idempotencyKey) {
    const inserted = await db.insert(jobs).values(values).onConflictDoNothing({ target: jobs.idempotencyKey }).returning();
    if (inserted[0]) return inserted[0];
    const existing = await db.query.jobs.findFirst({ where: eq(jobs.idempotencyKey, values.idempotencyKey) });
    if (!existing) throw new Error("Job idempotency conflict without existing row");
    return existing;
  }
  const [row] = await db.insert(jobs).values(values).returning();
  return row;
}

export async function claimNextJob(workerId: string): Promise<JobRecord | null> {
  const rows = await db.execute<JobRecord>(sql`
    UPDATE jobs SET status = 'RUNNING', locked_by = ${workerId}, locked_at = now(), started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'QUEUED' AND run_at <= now()
      ORDER BY priority ASC, run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);
  const raw = (rows as unknown as { rows?: JobRecord[] }).rows ?? (rows as unknown as JobRecord[]);
  const row = Array.isArray(raw) ? raw[0] : undefined;
  if (!row) return null;
  // postgres-js returns snake_case columns from raw SQL; re-read through drizzle for typed camelCase.
  const typed = await db.query.jobs.findFirst({ where: eq(jobs.id, (row as unknown as { id: string }).id) });
  return typed ?? null;
}

function backoffMs(attempt: number) {
  return Math.min(60_000 * 2 ** (attempt - 1), 30 * 60_000);
}

export async function runJob(job: JobRecord, workerId: string): Promise<void> {
  const handler = getJobHandler(job.type);
  const scoped = log.child(job.type);
  if (!handler) {
    await db.update(jobs).set({ status: "DEAD", finishedAt: new Date(), lastError: `No handler registered for ${job.type}` }).where(eq(jobs.id, job.id));
    scoped.error("no handler", { jobId: job.id });
    return;
  }
  try {
    const result = await handler(job.payload, {
      job,
      workerId,
      progress: async (done, total, message) => {
        await db.update(jobs).set({ progress: { done, total, message } }).where(eq(jobs.id, job.id));
      },
      log: (message, meta) => scoped.info(message, { jobId: job.id, ...meta }),
    });
    await db
      .update(jobs)
      .set({ status: "SUCCEEDED", finishedAt: new Date(), result: (result ?? null) as Record<string, unknown> | null, lockedBy: null, lockedAt: null, lastError: null })
      .where(eq(jobs.id, job.id));
    scoped.info("succeeded", { jobId: job.id });
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const exhausted = job.attempts >= job.maxAttempts;
    await db
      .update(jobs)
      .set({
        status: exhausted ? "DEAD" : "QUEUED",
        runAt: exhausted ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
        finishedAt: exhausted ? new Date() : null,
        lastError: message.slice(0, 4000),
        lockedBy: null,
        lockedAt: null,
      })
      .where(eq(jobs.id, job.id));
    scoped.error(exhausted ? "dead-lettered" : "failed, will retry", { jobId: job.id, attempt: job.attempts, err });
  }
}

/** Drain the queue: claim and run jobs until none is available or `max` is reached. */
export async function processQueue(options: { workerId?: string; max?: number } = {}) {
  const workerId = options.workerId ?? `inprocess-${process.pid}`;
  const max = options.max ?? 50;
  let processed = 0;
  while (processed < max) {
    const job = await claimNextJob(workerId);
    if (!job) break;
    await runJob(job, workerId);
    processed += 1;
  }
  return processed;
}

/** Recover jobs left RUNNING by a crashed worker (lock older than `staleMinutes`). */
export async function recoverStaleJobs(staleMinutes = 15) {
  const threshold = new Date(Date.now() - staleMinutes * 60_000);
  const rows = await db
    .update(jobs)
    .set({ status: "QUEUED", lockedBy: null, lockedAt: null, lastError: "Recovered from stale lock" })
    .where(and(eq(jobs.status, "RUNNING"), lte(jobs.lockedAt, threshold)))
    .returning({ id: jobs.id });
  if (rows.length) log.warn("recovered stale jobs", { count: rows.length });
  return rows.length;
}

export async function retryJob(jobId: string) {
  const [row] = await db
    .update(jobs)
    .set({ status: "QUEUED", runAt: new Date(), attempts: 0, lastError: null, finishedAt: null })
    .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["FAILED", "DEAD", "CANCELLED"])))
    .returning();
  return row ?? null;
}

export async function cancelJob(jobId: string) {
  const [row] = await db.update(jobs).set({ status: "CANCELLED", finishedAt: new Date() }).where(and(eq(jobs.id, jobId), eq(jobs.status, "QUEUED"))).returning();
  return row ?? null;
}

export async function listRecentJobs(limit = 50, editionId?: string) {
  return db.query.jobs.findMany({
    where: editionId ? eq(jobs.editionId, editionId) : undefined,
    orderBy: [asc(sql`case when ${jobs.status} in ('RUNNING','QUEUED') then 0 else 1 end`), sql`${jobs.createdAt} desc`],
    limit,
  });
}
