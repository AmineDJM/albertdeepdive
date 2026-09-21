import { and, asc, count, desc, eq, gte, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { safeRatio } from "@/server/analytics/compute";
import { workspaceScopeForAdmin } from "@/server/analytics/scope";
import {
  approvalLatency,
  contributionsByCampus,
  conversionFunnel,
  mostActiveContributors,
  readerDelivery,
  readerDeliveryByEdition,
  responseRateByPool,
  rightsByEdition,
  sectionCoverage,
  submissionTrend,
} from "@/server/analytics/read-insights";
import { editionAnalytics, editionComparison, listEditionOptions, SELECTED_STORY_STATUSES } from "@/server/analytics/service";

/**
 * Analytics for the people who run Briefly, as opposed to the people who use it.
 *
 * A separate module, and separate functions, on purpose. The tenant readers next door cannot be
 * called without a workspace — that is what makes a customer's page safe — so the console does not
 * get its cross-customer view by leaving an argument out. It gets it here, from queries written to
 * read across every workspace and used nowhere else, behind `platform:view`.
 *
 * Reading the two modules side by side should make it obvious which is which. A query in
 * `server/analytics` that has no workspace in it is a bug; a query in this file that has one is
 * either a drill-down or a mistake.
 */

const DAY = 24 * 60 * 60 * 1000;
const since = (days: number) => new Date(Date.now() - days * DAY);
const n = (value: unknown): number => Number(value ?? 0);

const DELIVERY = {
  sent: sql<number>`count(*) filter (where ${s.emailLog.sentAt} is not null)`,
  delivered: sql<number>`count(*) filter (where ${s.emailLog.deliveredAt} is not null)`,
  bounced: sql<number>`count(*) filter (where ${s.emailLog.bouncedAt} is not null)`,
  opened: sql<number>`count(*) filter (where ${s.emailLog.openedAt} is not null)`,
  clicked: sql<number>`count(*) filter (where ${s.emailLog.clickedAt} is not null)`,
};

export type Reach = {
  sent: number;
  delivered: number;
  bounced: number;
  opened: number;
  clicked: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  clickThroughRate: number;
};

function reachOf(row: { sent: number; delivered: number; bounced: number; opened: number; clicked: number }): Reach {
  return {
    ...row,
    deliveryRate: safeRatio(row.delivered, row.sent),
    openRate: safeRatio(row.opened, row.delivered),
    clickRate: safeRatio(row.clicked, row.delivered),
    clickThroughRate: safeRatio(row.clicked, row.opened),
  };
}

export type PlatformTotals = {
  days: number;
  workspaces: number;
  activeWorkspaces: number;
  users: number;
  publications: number;
  editions: number;
  publishedEditions: number;
  submissions: number;
  recipients: number;
  reach: Reach;
  storageBytes: number;
  aiCostCents: number;
  creativeCostCents: number;
};

/**
 * The whole platform, in one window. Every customer's rows, added up on purpose.
 *
 * "Active" is a workspace that did something inside the window rather than one that merely exists,
 * because the count that matters to somebody running this is how many newsrooms are working, not
 * how many rows are in the organisations table.
 */
export async function platformTotals(days = 30): Promise<PlatformTotals> {
  const from = since(days);
  const [
    [workspaces],
    [users],
    [publications],
    [editionRows],
    [submissions],
    [recipients],
    [delivery],
    [storage],
    [variantStorage],
    [creativeStorage],
    [ai],
    [creative],
    active,
  ] = await Promise.all([
    db.select({ n: count() }).from(s.organizations),
    db.select({ n: count() }).from(s.users),
    db.select({ n: count() }).from(s.publications),
    db
      .select({
        total: sql<number>`count(*)`,
        published: sql<number>`count(*) filter (where ${s.editions.status} = 'PUBLISHED')`,
      })
      .from(s.editions),
    db.select({ n: count() }).from(s.submissions).where(and(ne(s.submissions.status, "DRAFT"), gte(s.submissions.createdAt, from))),
    db.select({ n: count() }).from(s.subscribers).where(eq(s.subscribers.status, "SUBSCRIBED")),
    db.select(DELIVERY).from(s.emailLog).where(gte(s.emailLog.createdAt, from)),
    db.select({ bytes: sql<number>`coalesce(sum(${s.mediaAssets.sizeBytes}), 0)` }).from(s.mediaAssets),
    db.select({ bytes: sql<number>`coalesce(sum(${s.mediaVariants.sizeBytes}), 0)` }).from(s.mediaVariants),
    db.select({ bytes: sql<number>`coalesce(sum(${s.creativeAssets.sizeBytes}), 0)` }).from(s.creativeAssets),
    db.select({ cents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)` }).from(s.aiJobs).where(gte(s.aiJobs.createdAt, from)),
    db.select({ cents: sql<number>`coalesce(sum(${s.creativeCosts.costCents}), 0)` }).from(s.creativeCosts).where(gte(s.creativeCosts.createdAt, from)),
    db
      .select({ id: s.auditLog.organizationId })
      .from(s.auditLog)
      .where(and(isNotNull(s.auditLog.organizationId), gte(s.auditLog.createdAt, from)))
      .groupBy(s.auditLog.organizationId),
  ]);

  return {
    days,
    workspaces: n(workspaces?.n),
    activeWorkspaces: active.length,
    users: n(users?.n),
    publications: n(publications?.n),
    editions: n(editionRows?.total),
    publishedEditions: n(editionRows?.published),
    submissions: n(submissions?.n),
    recipients: n(recipients?.n),
    reach: reachOf({ sent: n(delivery?.sent), delivered: n(delivery?.delivered), bounced: n(delivery?.bounced), opened: n(delivery?.opened), clicked: n(delivery?.clicked) }),
    storageBytes: n(storage?.bytes) + n(variantStorage?.bytes) + n(creativeStorage?.bytes),
    aiCostCents: n(ai?.cents),
    creativeCostCents: n(creative?.cents),
  };
}

export type WorkspaceAnalyticsRow = {
  id: string;
  name: string;
  slug: string;
  planName: string | null;
  status: string;
  users: number;
  publications: number;
  editions: number;
  submissions: number;
  storageBytes: number;
  reach: Reach;
  lastActivity: Date | null;
};

/**
 * One row per customer, with the columns that answer "how is this customer using Briefly".
 *
 * One query per aggregate, grouped by workspace, rather than one pass per customer: the shape that
 * still loads when there are two hundred of them.
 */
export async function workspaceAnalyticsRows(days = 30): Promise<WorkspaceAnalyticsRow[]> {
  const from = since(days);
  const [organizations, subscriptions, members, publications, editions, submissions, media, variants, delivery, activity] = await Promise.all([
    db.select().from(s.organizations).orderBy(asc(s.organizations.name)),
    db
      .select({ organizationId: s.organizationSubscriptions.organizationId, status: s.organizationSubscriptions.status, planName: s.plans.name })
      .from(s.organizationSubscriptions)
      .leftJoin(s.plans, eq(s.plans.id, s.organizationSubscriptions.planId)),
    db.select({ id: s.organizationMembers.organizationId, n: count() }).from(s.organizationMembers).groupBy(s.organizationMembers.organizationId),
    db.select({ id: s.publications.organizationId, n: count() }).from(s.publications).groupBy(s.publications.organizationId),
    db.select({ id: s.editions.organizationId, n: count() }).from(s.editions).groupBy(s.editions.organizationId),
    db
      .select({ id: s.editions.organizationId, n: count() })
      .from(s.submissions)
      .innerJoin(s.editions, eq(s.editions.id, s.submissions.editionId))
      .where(and(ne(s.submissions.status, "DRAFT"), gte(s.submissions.createdAt, from)))
      .groupBy(s.editions.organizationId),
    db.select({ id: s.mediaAssets.organizationId, bytes: sql<number>`coalesce(sum(${s.mediaAssets.sizeBytes}), 0)` }).from(s.mediaAssets).groupBy(s.mediaAssets.organizationId),
    db
      .select({ id: s.mediaAssets.organizationId, bytes: sql<number>`coalesce(sum(${s.mediaVariants.sizeBytes}), 0)` })
      .from(s.mediaVariants)
      .innerJoin(s.mediaAssets, eq(s.mediaAssets.id, s.mediaVariants.assetId))
      .groupBy(s.mediaAssets.organizationId),
    db.select({ id: s.emailLog.organizationId, ...DELIVERY }).from(s.emailLog).where(gte(s.emailLog.createdAt, from)).groupBy(s.emailLog.organizationId),
    db
      .select({ id: s.auditLog.organizationId, at: sql<string | Date | null>`max(${s.auditLog.createdAt})` })
      .from(s.auditLog)
      .where(isNotNull(s.auditLog.organizationId))
      .groupBy(s.auditLog.organizationId),
  ]);

  function index<T extends { id: string | null }>(rows: T[]): Map<string, T> {
    return new Map(rows.filter((row) => row.id).map((row) => [row.id as string, row]));
  }
  const asDate = (value: string | Date | null | undefined): Date | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const plan = new Map(subscriptions.map((row) => [row.organizationId, row]));
  const byMembers = index(members);
  const byPublications = index(publications);
  const byEditions = index(editions);
  const bySubmissions = index(submissions);
  const byMedia = index(media);
  const byVariants = index(variants);
  const byDelivery = index(delivery);
  const bySeen = index(activity);

  return organizations.map((organization) => {
    const reach = byDelivery.get(organization.id);
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      planName: plan.get(organization.id)?.planName ?? null,
      status: plan.get(organization.id)?.status ?? "FREE",
      users: n(byMembers.get(organization.id)?.n),
      publications: n(byPublications.get(organization.id)?.n),
      editions: n(byEditions.get(organization.id)?.n),
      submissions: n(bySubmissions.get(organization.id)?.n),
      storageBytes: n(byMedia.get(organization.id)?.bytes) + n(byVariants.get(organization.id)?.bytes),
      reach: reachOf({ sent: n(reach?.sent), delivered: n(reach?.delivered), bounced: n(reach?.bounced), opened: n(reach?.opened), clicked: n(reach?.clicked) }),
      lastActivity: asDate(bySeen.get(organization.id)?.at),
    };
  });
}

export type EditionVolumeRow = { organizationId: string; name: string; editions: number; published: number };

/** Which customers make the most issues — the league table, ordered by what they actually shipped. */
export async function editionsByWorkspace(days = 90): Promise<EditionVolumeRow[]> {
  const rows = await db
    .select({
      organizationId: s.editions.organizationId,
      name: s.organizations.name,
      editions: sql<number>`count(*)`,
      published: sql<number>`count(*) filter (where ${s.editions.status} = 'PUBLISHED')`,
    })
    .from(s.editions)
    .innerJoin(s.organizations, eq(s.organizations.id, s.editions.organizationId))
    .where(gte(s.editions.createdAt, since(days)))
    .groupBy(s.editions.organizationId, s.organizations.name)
    .orderBy(desc(sql`count(*)`));
  return rows.filter((r) => r.organizationId).map((r) => ({ organizationId: r.organizationId as string, name: r.name, editions: n(r.editions), published: n(r.published) }));
}

/**
 * Everything a customer sees on their own Analytics page, for one named customer.
 *
 * The console reads the *same* functions the customer does, with a scope built from an explicit id
 * — so the two views cannot drift, and the console cannot accidentally see more than one workspace
 * because a `TenantScope` only ever names one. Authorization belongs to the caller: every use of
 * this sits behind `requirePermission("platform:view")`.
 */
export async function workspaceAnalyticsForAdmin(organizationId: string, days = 30, editionId?: string | null) {
  // The window is built here rather than by the page: reading the clock during a render is
  // impure, and a figure that changes between two renders of the same request is a figure nobody
  // can reconcile against the database.
  const scope = await workspaceScopeForAdmin(organizationId, { from: since(days), to: null }, editionId);
  const [organization, editions, analytics, comparison, trend, funnel, pools, coverage, latency, delivery, deliveryByEdition, rights, campuses, top] = await Promise.all([
    db.query.organizations.findFirst({ where: eq(s.organizations.id, scope.organizationId) }),
    listEditionOptions(scope),
    editionAnalytics(scope),
    editionComparison(scope),
    submissionTrend(scope),
    conversionFunnel(scope),
    responseRateByPool(scope),
    sectionCoverage(scope),
    approvalLatency(scope),
    readerDelivery(scope),
    readerDeliveryByEdition(scope),
    rightsByEdition(scope),
    contributionsByCampus(scope),
    mostActiveContributors(scope),
  ]);
  return { scope, organization, editions, analytics, comparison, trend, funnel, pools, coverage, latency, delivery, deliveryByEdition, rights, campuses, top };
}

/**
 * What a workspace cost to run in the window — the half of the picture the customer never sees.
 *
 * Kept here rather than beside the customer's figures for the reason the whole split exists: a
 * newsroom cannot act on the price of its own tokens, and showing it to them was a strange thing
 * to do. Somebody does have to see it, and this is where they do.
 */
export async function workspaceCostsForAdmin(organizationId: string, days = 30) {
  const from = since(days);
  const [[ai], byService, byModel, [creative], [speech]] = await Promise.all([
    db
      .select({
        calls: sql<number>`count(*)`,
        tokens: sql<number>`coalesce(sum(coalesce(${s.aiJobs.inputTokens}, 0) + coalesce(${s.aiJobs.outputTokens}, 0)), 0)`,
        cents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)`,
        failed: sql<number>`count(*) filter (where ${s.aiJobs.status} = 'FAILED')`,
        cached: sql<number>`count(*) filter (where ${s.aiJobs.cached})`,
      })
      .from(s.aiJobs)
      .where(and(eq(s.aiJobs.organizationId, organizationId), gte(s.aiJobs.createdAt, from))),
    db
      .select({ service: s.aiJobs.service, calls: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)` })
      .from(s.aiJobs)
      .where(and(eq(s.aiJobs.organizationId, organizationId), gte(s.aiJobs.createdAt, from)))
      .groupBy(s.aiJobs.service)
      .orderBy(desc(sql`coalesce(sum(${s.aiJobs.costCents}), 0)`)),
    db
      .select({ model: s.aiJobs.model, provider: s.aiJobs.provider, calls: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)` })
      .from(s.aiJobs)
      .where(and(eq(s.aiJobs.organizationId, organizationId), gte(s.aiJobs.createdAt, from)))
      .groupBy(s.aiJobs.model, s.aiJobs.provider)
      .orderBy(desc(sql`coalesce(sum(${s.aiJobs.costCents}), 0)`)),
    db
      .select({ cents: sql<number>`coalesce(sum(${s.creativeCosts.costCents}), 0)` })
      .from(s.creativeCosts)
      .where(and(eq(s.creativeCosts.organizationId, organizationId), gte(s.creativeCosts.createdAt, from))),
    db
      .select({ bytes: sql<number>`coalesce(sum(${s.mediaAssets.sizeBytes}), 0)` })
      .from(s.mediaAssets)
      .where(eq(s.mediaAssets.organizationId, organizationId)),
  ]);
  return {
    days,
    aiCalls: n(ai?.calls),
    aiTokens: n(ai?.tokens),
    aiCents: n(ai?.cents),
    aiFailed: n(ai?.failed),
    aiCached: n(ai?.cached),
    creativeCents: n(creative?.cents),
    storageBytes: n(speech?.bytes),
    byService: byService.map((r) => ({ service: r.service, calls: n(r.calls), cents: n(r.cents) })),
    byModel: byModel.map((r) => ({ model: r.model, provider: r.provider, calls: n(r.calls), cents: n(r.cents) })),
  };
}

/** Selected stories across the platform, by story type — what Briefly is actually used to publish. */
export async function platformStoryMix(days = 90): Promise<{ storyType: string; count: number }[]> {
  const where: SQL[] = [inArray(s.stories.status, [...SELECTED_STORY_STATUSES]), gte(s.stories.createdAt, since(days))];
  const rows = await db
    .select({ storyType: s.stories.storyType, count: sql<number>`count(*)` })
    .from(s.stories)
    .where(and(...where))
    .groupBy(s.stories.storyType)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ storyType: r.storyType, count: n(r.count) }));
}
