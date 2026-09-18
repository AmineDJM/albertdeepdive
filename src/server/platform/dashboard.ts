import { and, count, desc, eq, gte, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { integrationStatuses } from "@/server/integrations/service";
import { platformBillingSummary } from "@/server/billing/entitlements";

/**
 * The state of this Briefly, on one screen.
 *
 * Deliberately the *platform's* view and not a workspace's: it reads across every customer, which is
 * a thing no other query in the product is allowed to do. The numbers are chosen to answer the four
 * questions somebody running a SaaS actually has at nine in the morning — is it making money, is
 * anyone using it, is it broken, and is it about to cost me more than it earns.
 *
 * Everything is read straight from the tables. There is no rollup job to be stale, and nothing here
 * is estimated: a figure a person might act on should not be a guess.
 */

const DAY = 24 * 60 * 60 * 1000;
const since = (days: number) => new Date(Date.now() - days * DAY);

/**
 * A timestamp Postgres will accept inside a raw expression.
 *
 * A bare parameter next to a `coalesce(...)` or inside a `filter (where ...)` has no column to lend
 * it a type, so the driver is handed a Date it cannot encode. Sending the ISO string with an explicit
 * cast is the fix, and it is also the honest one: the type belongs in the SQL, not in a guess.
 */
const ts = (date: Date) => sql`${date.toISOString()}::timestamptz`;


export type PlatformHealth = {
  revenue: { mrrCents: number; payingWorkspaces: number; freeWorkspaces: number; trialing: number; pastDue: number };
  growth: { workspacesTotal: number; workspacesNew30: number; usersTotal: number; subscribersTotal: number };
  activity: { editions30: number; publishedEditions30: number; emailsSent30: number; publicationsTotal: number };
  spend: { aiCostCents30: number; aiCalls30: number; aiTokens30: number; costPerWorkspaceCents: number };
  reliability: { jobsQueued: number; jobsRunning: number; jobsFailed24: number; emailsFailed24: number; aiErrors24: number };
  integrations: { key: string; name: string; configured: boolean; whenMissing: string }[];
  plans: Awaited<ReturnType<typeof platformBillingSummary>>["rows"];
};

export async function platformHealth(): Promise<PlatformHealth> {
  const day = since(1);
  const month = since(30);

  const [
    billing,
    [orgTotals],
    [userTotals],
    [subscriberTotals],
    [publicationTotals],
    [editionStats],
    [emailStats],
    [aiStats],
    [jobStats],
    [aiErrors],
    subscriptionStates,
    integrations,
  ] = await Promise.all([
    platformBillingSummary(),
    db.select({ total: count(), recent: sql<number>`count(*) filter (where ${s.organizations.createdAt} >= ${ts(month)})` }).from(s.organizations),
    db.select({ total: count() }).from(s.users),
    db.select({ total: count() }).from(s.subscribers).where(eq(s.subscribers.status, "SUBSCRIBED")),
    db.select({ total: count() }).from(s.publications),
    db
      .select({
        created: sql<number>`count(*) filter (where ${s.editions.createdAt} >= ${ts(month)})`,
        published: sql<number>`count(*) filter (where ${s.editions.status} = 'PUBLISHED' and ${s.editions.updatedAt} >= ${ts(month)})`,
      })
      .from(s.editions),
    db
      .select({
        sent: sql<number>`count(*) filter (where ${s.emailLog.createdAt} >= ${ts(month)} and ${s.emailLog.status} = 'SENT')`,
        failed: sql<number>`count(*) filter (where ${s.emailLog.createdAt} >= ${ts(day)} and ${s.emailLog.status} = 'FAILED')`,
      })
      .from(s.emailLog),
    db
      .select({
        costCents: sql<number>`coalesce(sum(${s.aiJobs.costCents}) filter (where ${s.aiJobs.createdAt} >= ${ts(month)}), 0)`,
        calls: sql<number>`count(*) filter (where ${s.aiJobs.createdAt} >= ${ts(month)})`,
        tokens: sql<number>`coalesce(sum(coalesce(${s.aiJobs.inputTokens},0) + coalesce(${s.aiJobs.outputTokens},0)) filter (where ${s.aiJobs.createdAt} >= ${ts(month)}), 0)`,
      })
      .from(s.aiJobs),
    db
      .select({
        queued: sql<number>`count(*) filter (where ${s.jobs.status} = 'QUEUED')`,
        running: sql<number>`count(*) filter (where ${s.jobs.status} = 'RUNNING')`,
        failed: sql<number>`count(*) filter (where ${s.jobs.status} in ('FAILED','DEAD') and coalesce(${s.jobs.finishedAt}, ${s.jobs.createdAt}) >= ${ts(day)})`,
      })
      .from(s.jobs),
    db.select({ n: count() }).from(s.aiJobs).where(and(gte(s.aiJobs.createdAt, day), eq(s.aiJobs.status, "FAILED"))),
    db.select({ status: s.organizationSubscriptions.status, n: count() }).from(s.organizationSubscriptions).groupBy(s.organizationSubscriptions.status),
    integrationStatuses(),
  ]);

  const byStatus = new Map(subscriptionStates.map((row) => [row.status, Number(row.n)]));
  const paying = (byStatus.get("ACTIVE") ?? 0) + (byStatus.get("TRIALING") ?? 0) + (byStatus.get("PAST_DUE") ?? 0);
  const workspacesTotal = Number(orgTotals.total);
  const aiCostCents30 = Number(aiStats.costCents);

  return {
    revenue: {
      mrrCents: billing.mrrCents,
      payingWorkspaces: paying,
      freeWorkspaces: Math.max(0, workspacesTotal - paying),
      trialing: byStatus.get("TRIALING") ?? 0,
      pastDue: byStatus.get("PAST_DUE") ?? 0,
    },
    growth: {
      workspacesTotal,
      workspacesNew30: Number(orgTotals.recent),
      usersTotal: Number(userTotals.total),
      subscribersTotal: Number(subscriberTotals.total),
    },
    activity: {
      editions30: Number(editionStats.created),
      publishedEditions30: Number(editionStats.published),
      emailsSent30: Number(emailStats.sent),
      publicationsTotal: Number(publicationTotals.total),
    },
    spend: {
      aiCostCents30,
      aiCalls30: Number(aiStats.calls),
      aiTokens30: Number(aiStats.tokens),
      // The number that decides whether the pricing works. A workspace that costs more in models
      // than it pays in subscription is a workspace sold at a loss, and you want to know early.
      costPerWorkspaceCents: workspacesTotal ? Math.round(aiCostCents30 / workspacesTotal) : 0,
    },
    reliability: {
      jobsQueued: Number(jobStats.queued),
      jobsRunning: Number(jobStats.running),
      jobsFailed24: Number(jobStats.failed),
      emailsFailed24: Number(emailStats.failed),
      aiErrors24: Number(aiErrors.n),
    },
    integrations: integrations.map((integration) => ({
      key: integration.key,
      name: integration.name,
      configured: integration.configured,
      whenMissing: integration.whenMissing,
    })),
    plans: billing.rows,
  };
}

/* ── Every customer, with enough to act on ────────────────────────────────────────────────── */

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  type: string;
  createdAt: Date;
  planName: string | null;
  planKey: string | null;
  status: string;
  hasOverrides: boolean;
  members: number;
  publications: number;
  editions: number;
  subscribers: number;
  lastActivity: Date | null;
  aiCostCents: number;
};

/**
 * The customer list, with the columns you would actually sort by.
 *
 * One query per aggregate rather than one query per workspace: a list screen that issues a query per
 * row is a list screen that stops loading at two hundred customers, which is exactly when it starts
 * mattering.
 */
export async function listWorkspaceRows(): Promise<WorkspaceRow[]> {
  const month = since(30);

  const [organizations, subscriptions, memberCounts, publicationCounts, editionCounts, subscriberCounts, activity, aiCosts] = await Promise.all([
    db.select().from(s.organizations).orderBy(desc(s.organizations.createdAt)),
    db
      .select({
        organizationId: s.organizationSubscriptions.organizationId,
        status: s.organizationSubscriptions.status,
        overrides: s.organizationSubscriptions.overrides,
        planName: s.plans.name,
        planKey: s.plans.key,
      })
      .from(s.organizationSubscriptions)
      .leftJoin(s.plans, eq(s.plans.id, s.organizationSubscriptions.planId)),
    db.select({ id: s.organizationMembers.organizationId, n: count() }).from(s.organizationMembers).groupBy(s.organizationMembers.organizationId),
    db.select({ id: s.publications.organizationId, n: count() }).from(s.publications).groupBy(s.publications.organizationId),
    db.select({ id: s.editions.organizationId, n: count() }).from(s.editions).groupBy(s.editions.organizationId),
    db
      .select({ id: s.subscribers.organizationId, n: count() })
      .from(s.subscribers)
      .where(eq(s.subscribers.status, "SUBSCRIBED"))
      .groupBy(s.subscribers.organizationId),
    db
      // An aggregate comes back as a string, not a Date: drizzle only maps declared columns. It is
      // coerced below, because a caller that sorts by it will otherwise call getTime on text — a
      // crash that hid for months behind a single-row list, which never runs a comparator.
      .select({ id: s.auditLog.organizationId, at: sql<string | Date | null>`max(${s.auditLog.createdAt})` })
      .from(s.auditLog)
      .where(isNotNull(s.auditLog.organizationId))
      .groupBy(s.auditLog.organizationId),
    db
      .select({ id: s.aiJobs.organizationId, cents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)` })
      .from(s.aiJobs)
      .where(and(isNotNull(s.aiJobs.organizationId), gte(s.aiJobs.createdAt, month)))
      .groupBy(s.aiJobs.organizationId),
  ]);

  const index = <T extends { id: string | null }>(rows: T[]) => new Map(rows.filter((row) => row.id).map((row) => [row.id as string, row]));
  const asDate = (value: string | Date | null | undefined): Date | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const subscriptionByOrg = new Map(subscriptions.map((row) => [row.organizationId, row]));
  const members = index(memberCounts);
  const publications = index(publicationCounts);
  const editions = index(editionCounts);
  const subscribers = index(subscriberCounts);
  const lastSeen = index(activity);
  const costs = index(aiCosts);

  return organizations.map((organization) => {
    const subscription = subscriptionByOrg.get(organization.id);
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      type: organization.type,
      createdAt: organization.createdAt,
      planName: subscription?.planName ?? null,
      planKey: subscription?.planKey ?? null,
      status: subscription?.status ?? "FREE",
      hasOverrides: Object.keys(subscription?.overrides ?? {}).length > 0,
      members: Number(members.get(organization.id)?.n ?? 0),
      publications: Number(publications.get(organization.id)?.n ?? 0),
      editions: Number(editions.get(organization.id)?.n ?? 0),
      subscribers: Number(subscribers.get(organization.id)?.n ?? 0),
      lastActivity: asDate(lastSeen.get(organization.id)?.at),
      aiCostCents: Number(costs.get(organization.id)?.cents ?? 0),
    };
  });
}

/** What has gone wrong lately, across every customer, newest first. */
export async function recentFailures(limit = 25) {
  const day = since(2);
  const [jobs, emails, ai] = await Promise.all([
    db
      .select({ id: s.jobs.id, at: sql<Date>`coalesce(${s.jobs.finishedAt}, ${s.jobs.createdAt})`, kind: s.jobs.type, detail: s.jobs.lastError, organizationId: s.jobs.organizationId })
      .from(s.jobs)
      .where(and(inArray(s.jobs.status, ["FAILED", "DEAD"]), sql`coalesce(${s.jobs.finishedAt}, ${s.jobs.createdAt}) >= ${ts(day)}`))
      .orderBy(desc(sql`coalesce(${s.jobs.finishedAt}, ${s.jobs.createdAt})`))
      .limit(limit),
    db
      .select({ id: s.emailLog.id, at: s.emailLog.createdAt, kind: s.emailLog.status, detail: s.emailLog.error, organizationId: s.emailLog.organizationId })
      .from(s.emailLog)
      .where(and(eq(s.emailLog.status, "FAILED"), gte(s.emailLog.createdAt, day)))
      .orderBy(desc(s.emailLog.createdAt))
      .limit(limit),
    db
      .select({ id: s.aiJobs.id, at: s.aiJobs.createdAt, kind: s.aiJobs.service, detail: s.aiJobs.error, organizationId: s.aiJobs.organizationId })
      .from(s.aiJobs)
      .where(and(eq(s.aiJobs.status, "FAILED"), gte(s.aiJobs.createdAt, day)))
      .orderBy(desc(s.aiJobs.createdAt))
      .limit(limit),
  ]);

  const names = new Map((await db.select({ id: s.organizations.id, name: s.organizations.name }).from(s.organizations)).map((row) => [row.id, row.name]));
  const tag = (source: "Job" | "Email" | "AI", rows: typeof jobs) =>
    rows.map((row) => ({
      id: `${source}-${row.id}`,
      source,
      at: row.at,
      kind: row.kind ?? "",
      detail: row.detail ?? "",
      workspace: row.organizationId ? (names.get(row.organizationId) ?? null) : null,
    }));

  return [...tag("Job", jobs), ...tag("Email", emails), ...tag("AI", ai)].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/** Workspaces that have stopped doing anything, which is what churn looks like before it is churn. */
export async function dormantWorkspaces(days = 21) {
  const rows = await listWorkspaceRows();
  const cutoff = since(days);
  return rows.filter((row) => row.editions > 0 && (!row.lastActivity || row.lastActivity < cutoff));
}

/** Kept for the page that only needs the headline. */
export async function workspaceCount() {
  const [row] = await db.select({ n: count() }).from(s.organizations).where(ne(s.organizations.name, ""));
  return Number(row.n);
}
