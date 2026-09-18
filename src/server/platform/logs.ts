import { and, desc, eq, gte, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";

/**
 * Every log Briefly keeps, read across every customer.
 *
 * A workspace can already see its own audit trail, its own sent mail and its own job queue. This is
 * the same material from the other side of the counter: somebody supporting a customer needs to
 * answer "what happened to them at 14:02" without first asking which of four screens to open, and
 * without switching workspace to find out.
 *
 * Four sources, one shape, one timeline. They genuinely are different tables with different columns,
 * and the alternative — a single events table everything writes to — would mean the audit trail and
 * the mail log competing for the same index, so they are unified at read time instead.
 */

export const LOG_SOURCES = ["audit", "jobs", "email", "ai"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export const LOG_SOURCE_LABELS: Record<LogSource, string> = {
  audit: "Actions",
  jobs: "Jobs",
  email: "Email",
  ai: "Model calls",
};

export type LogEntry = {
  id: string;
  source: LogSource;
  at: Date;
  /** What happened, in the vocabulary of its own source. */
  action: string;
  /** Who or what did it. */
  actor: string | null;
  /** The subject, when there is one. */
  subject: string | null;
  /** Failure text, or the payload summary. Absent for the ordinary case. */
  detail: string | null;
  organizationId: string | null;
  workspace: string | null;
  failed: boolean;
};

export type LogFilters = {
  sources?: LogSource[];
  organizationId?: string;
  query?: string;
  onlyFailures?: boolean;
  sinceDays?: number;
};

const clampLimit = (limit: number) => Math.max(1, Math.min(200, limit));

/**
 * A timestamp Postgres will accept inside a raw expression.
 *
 * A bare parameter next to a `coalesce(...)` or inside a `filter (where ...)` has no column to lend
 * it a type, so the driver is handed a Date it cannot encode. Sending the ISO string with an explicit
 * cast is the fix, and it is also the honest one: the type belongs in the SQL, not in a guess.
 */
const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;


/**
 * A timestamp, whatever the driver handed back.
 *
 * Three of these four sources select a real column and get a `Date`; the jobs one selects
 * `coalesce(finished, started, created)`, and a raw SQL expression has no column to borrow a type
 * mapper from, so it arrives as a string however it is typed in TypeScript. Sorting then threw
 * `at.getTime is not a function` and the whole Logs page rendered nothing — blank, in production,
 * the moment a single job had run.
 *
 * Normalised here rather than at the one query that was wrong, because the next raw expression
 * somebody adds will have the same problem and should not be able to blank the page again.
 */
function asDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

export async function readLogs(filters: LogFilters = {}, limit = 80): Promise<LogEntry[]> {
  const sources = filters.sources?.length ? filters.sources : [...LOG_SOURCES];
  const since = new Date(Date.now() - (filters.sinceDays ?? 7) * 24 * 60 * 60 * 1000);
  const perSource = clampLimit(limit);
  const query = filters.query?.trim();
  const like = query ? `%${query}%` : null;

  // Each source is asked for its own most-recent slice and the whole lot is merged and re-sorted.
  // A single UNION would be tidier in SQL and much worse in practice: four tables with four
  // different indexes, and the planner has to materialise all of them before it can sort.
  // Typed loosely on purpose: it is the same predicate against four different tables' columns, and
  // pinning it to one of them just means writing it four times.
  const workspaceFilter = (column: PgColumn) => (filters.organizationId ? eq(column, filters.organizationId) : undefined);

  const [audits, jobs, emails, ai, organizations] = await Promise.all([
    sources.includes("audit")
      ? db
          .select({
            id: s.auditLog.id,
            at: s.auditLog.createdAt,
            action: s.auditLog.action,
            actorName: s.users.name,
            actorType: s.auditLog.actorType,
            entityType: s.auditLog.entityType,
            entityId: s.auditLog.entityId,
            metadata: s.auditLog.metadata,
            organizationId: s.auditLog.organizationId,
          })
          .from(s.auditLog)
          .leftJoin(s.users, eq(s.users.id, s.auditLog.userId))
          .where(
            and(
              gte(s.auditLog.createdAt, since),
              workspaceFilter(s.auditLog.organizationId),
              like ? or(ilike(s.auditLog.action, like), ilike(s.users.name, like), ilike(s.users.email, like)) : undefined,
            ),
          )
          .orderBy(desc(s.auditLog.createdAt))
          .limit(perSource)
      : [],
    sources.includes("jobs")
      ? db
          .select({
            id: s.jobs.id,
            at: sql<Date>`coalesce(${s.jobs.finishedAt}, ${s.jobs.startedAt}, ${s.jobs.createdAt})`,
            type: s.jobs.type,
            status: s.jobs.status,
            lastError: s.jobs.lastError,
            attempts: s.jobs.attempts,
            organizationId: s.jobs.organizationId,
          })
          .from(s.jobs)
          .where(
            and(
              sql`coalesce(${s.jobs.finishedAt}, ${s.jobs.startedAt}, ${s.jobs.createdAt}) >= ${ts(since)}`,
              workspaceFilter(s.jobs.organizationId),
              like ? or(ilike(s.jobs.type, like), ilike(s.jobs.lastError, like)) : undefined,
              filters.onlyFailures ? sql`${s.jobs.status} in ('FAILED','DEAD')` : undefined,
            ),
          )
          .orderBy(desc(sql`coalesce(${s.jobs.finishedAt}, ${s.jobs.startedAt}, ${s.jobs.createdAt})`))
          .limit(perSource)
      : [],
    sources.includes("email")
      ? db
          .select({
            id: s.emailLog.id,
            at: s.emailLog.createdAt,
            status: s.emailLog.status,
            subject: s.emailLog.subject,
            to: s.emailLog.to,
            error: s.emailLog.error,
            organizationId: s.emailLog.organizationId,
          })
          .from(s.emailLog)
          .where(
            and(
              gte(s.emailLog.createdAt, since),
              workspaceFilter(s.emailLog.organizationId),
              like ? or(ilike(s.emailLog.subject, like), ilike(s.emailLog.to, like)) : undefined,
              filters.onlyFailures ? eq(s.emailLog.status, "FAILED") : undefined,
            ),
          )
          .orderBy(desc(s.emailLog.createdAt))
          .limit(perSource)
      : [],
    sources.includes("ai")
      ? db
          .select({
            id: s.aiJobs.id,
            at: s.aiJobs.createdAt,
            service: s.aiJobs.service,
            model: s.aiJobs.model,
            status: s.aiJobs.status,
            error: s.aiJobs.error,
            costCents: s.aiJobs.costCents,
            organizationId: s.aiJobs.organizationId,
          })
          .from(s.aiJobs)
          .where(
            and(
              gte(s.aiJobs.createdAt, since),
              workspaceFilter(s.aiJobs.organizationId),
              like ? or(ilike(s.aiJobs.service, like), ilike(s.aiJobs.model, like)) : undefined,
              filters.onlyFailures ? eq(s.aiJobs.status, "FAILED") : undefined,
            ),
          )
          .orderBy(desc(s.aiJobs.createdAt))
          .limit(perSource)
      : [],
    db.select({ id: s.organizations.id, name: s.organizations.name }).from(s.organizations),
  ]);

  const names = new Map(organizations.map((row) => [row.id, row.name]));
  const workspace = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  const entries: LogEntry[] = [
    ...audits.map((row) => ({
      id: `audit-${row.id}`,
      source: "audit" as const,
      at: asDate(row.at),
      action: row.action,
      actor: row.actorName ?? (row.actorType === "USER" ? "Someone" : row.actorType.toLowerCase()),
      subject: row.entityType ? `${row.entityType.toLowerCase()}${row.entityId ? ` ${row.entityId.slice(0, 8)}` : ""}` : null,
      detail: summarise(row.metadata),
      organizationId: row.organizationId,
      workspace: workspace(row.organizationId),
      failed: false,
    })),
    ...jobs.map((row) => ({
      id: `jobs-${row.id}`,
      source: "jobs" as const,
      at: asDate(row.at),
      action: row.type,
      actor: "queue",
      subject: row.status.toLowerCase(),
      detail: row.lastError ?? (row.attempts > 1 ? `${row.attempts} attempts` : null),
      organizationId: row.organizationId,
      workspace: workspace(row.organizationId),
      failed: row.status === "FAILED" || row.status === "DEAD",
    })),
    ...emails.map((row) => ({
      id: `email-${row.id}`,
      source: "email" as const,
      at: asDate(row.at),
      action: row.status.toLowerCase(),
      actor: "mailer",
      subject: row.to,
      detail: row.error ?? row.subject,
      organizationId: row.organizationId,
      workspace: workspace(row.organizationId),
      failed: row.status === "FAILED",
    })),
    ...ai.map((row) => ({
      id: `ai-${row.id}`,
      source: "ai" as const,
      at: asDate(row.at),
      action: row.service,
      actor: row.model ?? "model",
      subject: row.status.toLowerCase(),
      detail: row.error ?? (row.costCents ? `${(Number(row.costCents) / 100).toFixed(4)} EUR` : null),
      organizationId: row.organizationId,
      workspace: workspace(row.organizationId),
      failed: row.status === "FAILED",
    })),
  ];

  // Each source already filtered itself; audit has no notion of failure, so asking for failures only
  // means asking for the three sources that have one.
  return entries
    .filter((entry) => !filters.onlyFailures || entry.failed)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, clampLimit(limit));
}

/** Metadata is free-form, so it is summarised rather than rendered — a log line is one line. */
function summarise(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const entries = Object.entries(metadata as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.slice(0, 3).join(", ") : String(value).slice(0, 60)}`);
  return entries.length ? entries.join(" · ") : null;
}

/** The workspaces that appear in the logs, for the filter. */
export async function loggedWorkspaces() {
  return db
    .select({ id: s.organizations.id, name: s.organizations.name })
    .from(s.organizations)
    .where(isNotNull(s.organizations.id))
    .orderBy(s.organizations.name);
}

export type LogQuery = SQL | undefined;
