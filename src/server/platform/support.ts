import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { listWorkspaceRows } from "./dashboard";

/**
 * A customer's trouble, on one screen.
 *
 * Support starts with "something is wrong for X" and used to go on with a search through four
 * logs. This reads the four in one pass, per organisation: what failed in the last week, what is
 * stuck in the queue, whether the bill is paid, and when anyone was last there.
 */

const DAY = 24 * 60 * 60 * 1000;

export type SupportRow = {
  id: string;
  name: string;
  slug: string;
  planName: string | null;
  subscriptionStatus: string | null;
  members: number;
  lastActivity: Date | null;
  failedJobs7: number;
  queuedJobs: number;
  failedEmails7: number;
  aiErrors7: number;
  /** A score for sorting: the customers most likely to write in come first. */
  trouble: number;
};

export async function supportRows(): Promise<SupportRow[]> {
  const since = new Date(Date.now() - 7 * DAY);
  const [rows, jobs, queued, emails, ai] = await Promise.all([
    listWorkspaceRows(),
    db.select({ organizationId: s.jobs.organizationId, n: sql<number>`count(*)` }).from(s.jobs).where(and(inArray(s.jobs.status, ["FAILED", "DEAD"]), gte(s.jobs.createdAt, since))).groupBy(s.jobs.organizationId),
    db.select({ organizationId: s.jobs.organizationId, n: sql<number>`count(*)` }).from(s.jobs).where(inArray(s.jobs.status, ["QUEUED", "RUNNING"])).groupBy(s.jobs.organizationId),
    db.select({ organizationId: s.emailLog.organizationId, n: sql<number>`count(*)` }).from(s.emailLog).where(and(eq(s.emailLog.status, "FAILED"), gte(s.emailLog.createdAt, since))).groupBy(s.emailLog.organizationId),
    db.select({ organizationId: s.aiJobs.organizationId, n: sql<number>`count(*)` }).from(s.aiJobs).where(and(eq(s.aiJobs.status, "FAILED"), gte(s.aiJobs.createdAt, since))).groupBy(s.aiJobs.organizationId),
  ]);
  const count = (list: { organizationId: string | null; n: number }[]) => new Map(list.filter((row) => row.organizationId).map((row) => [row.organizationId!, Number(row.n)]));
  const failedJobs = count(jobs);
  const queuedJobs = count(queued);
  const failedEmails = count(emails);
  const aiErrors = count(ai);
  return rows
    .map((row) => {
      const fj = failedJobs.get(row.id) ?? 0;
      const fe = failedEmails.get(row.id) ?? 0;
      const fa = aiErrors.get(row.id) ?? 0;
      const pastDue = row.status === "PAST_DUE" ? 1 : 0;
      return { id: row.id, name: row.name, slug: row.slug, planName: row.planName, subscriptionStatus: row.status, members: row.members, lastActivity: row.lastActivity, failedJobs7: fj, queuedJobs: queuedJobs.get(row.id) ?? 0, failedEmails7: fe, aiErrors7: fa, trouble: fj * 3 + fe * 2 + fa + pastDue * 5 };
    })
    .sort((a, b) => b.trouble - a.trouble || (b.lastActivity?.getTime() ?? 0) - (a.lastActivity?.getTime() ?? 0));
}

export type SupportEvent = { id: string; source: "Job" | "Email" | "AI"; at: Date; kind: string; detail: string };

/** The last things that went wrong for one customer, newest first. */
export async function supportEvents(organizationId: string, limit = 30): Promise<SupportEvent[]> {
  const since = new Date(Date.now() - 30 * DAY);
  const [jobs, emails, ai] = await Promise.all([
    db.select({ id: s.jobs.id, at: sql<Date>`coalesce(${s.jobs.finishedAt}, ${s.jobs.createdAt})`, kind: s.jobs.type, detail: s.jobs.lastError }).from(s.jobs).where(and(eq(s.jobs.organizationId, organizationId), inArray(s.jobs.status, ["FAILED", "DEAD"]), gte(s.jobs.createdAt, since))).orderBy(desc(s.jobs.createdAt)).limit(limit),
    db.select({ id: s.emailLog.id, at: s.emailLog.createdAt, kind: s.emailLog.status, detail: s.emailLog.error }).from(s.emailLog).where(and(eq(s.emailLog.organizationId, organizationId), eq(s.emailLog.status, "FAILED"), gte(s.emailLog.createdAt, since))).orderBy(desc(s.emailLog.createdAt)).limit(limit),
    db.select({ id: s.aiJobs.id, at: s.aiJobs.createdAt, kind: s.aiJobs.service, detail: s.aiJobs.error }).from(s.aiJobs).where(and(eq(s.aiJobs.organizationId, organizationId), eq(s.aiJobs.status, "FAILED"), gte(s.aiJobs.createdAt, since))).orderBy(desc(s.aiJobs.createdAt)).limit(limit),
  ]);
  const tag = (source: SupportEvent["source"], list: { id: string; at: Date; kind: string | null; detail: string | null }[]) => list.map((row) => ({ id: `${source}-${row.id}`, source, at: new Date(row.at), kind: row.kind ?? "", detail: row.detail ?? "" }));
  return [...tag("Job", jobs), ...tag("Email", emails), ...tag("AI", ai)].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export type AdminJobRow = {
  id: string;
  type: string;
  status: (typeof s.jobs.$inferSelect)["status"];
  organizationId: string | null;
  organizationName: string | null;
  editionLabel: string | null;
  attempts: number;
  maxAttempts: number;
  runAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  lastError: string | null;
  progress: { done: number; total: number; message?: string } | null;
};

export type AdminJobFilters = { status?: string; type?: string; organizationId?: string };

/** Every organisation's queue, on one list: running and queued first, then what just finished. */
export async function adminJobs(filters: AdminJobFilters = {}, limit = 80): Promise<AdminJobRow[]> {
  const where = [] as ReturnType<typeof eq>[];
  if (filters.status === "active") where.push(inArray(s.jobs.status, ["QUEUED", "RUNNING"]));
  else if (filters.status === "problem") where.push(inArray(s.jobs.status, ["FAILED", "DEAD"]));
  else if (filters.status) where.push(sql`${s.jobs.status}::text = ${filters.status}`);
  if (filters.type) where.push(eq(s.jobs.type, filters.type));
  if (filters.organizationId) where.push(eq(s.jobs.organizationId, filters.organizationId));
  const rows = await db
    .select({ job: s.jobs, organizationName: s.organizations.name, editionLabel: s.editions.label })
    .from(s.jobs)
    .leftJoin(s.organizations, eq(s.organizations.id, s.jobs.organizationId))
    .leftJoin(s.editions, eq(s.editions.id, s.jobs.editionId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`case when ${s.jobs.status} = 'RUNNING' then 0 when ${s.jobs.status} = 'QUEUED' then 1 when ${s.jobs.status} in ('FAILED', 'DEAD') then 2 else 3 end`, desc(sql`coalesce(${s.jobs.finishedAt}, ${s.jobs.startedAt}, ${s.jobs.runAt}, ${s.jobs.createdAt})`))
    .limit(limit);
  return rows.map(({ job, organizationName, editionLabel }) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    organizationId: job.organizationId,
    organizationName,
    editionLabel,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    runAt: job.runAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : null,
    lastError: job.lastError,
    progress: job.progress,
  }));
}
