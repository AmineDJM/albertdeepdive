import { and, count, desc, eq, gt, gte, inArray, isNotNull, sql, type AnyColumn } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { readLogs, type LogEntry } from "./logs";
import { invoicesForWorkspace, subscriptionRows, type InvoiceRow, type SubscriptionRow } from "./payments";
import { usageReport } from "@/server/billing/entitlements";
import type { Role } from "@/lib/auth/permissions";

/**
 * Insights: what one customer, one person, or the whole platform costs and does.
 *
 * Everything here reads across workspaces, which only the console may do, and everything is read
 * straight from the ledgers — model calls, generated pictures, email, files — rather than from a
 * rollup somebody has to remember to refresh. Money is cents; a cost per customer is a sum over
 * their rows, and a margin is that sum against what their plan brings in over the same days.
 */

const DAY = 24 * 60 * 60 * 1000;
const since = (days: number) => new Date(Date.now() - days * DAY);
const num = (value: unknown) => Number(value ?? 0);
/** The key for rows that belong to no workspace: platform-level calls, and rows older than tenancy. */
const NONE = "";

export const COST_WINDOWS = [7, 30, 90] as const;
export type CostWindow = (typeof COST_WINDOWS)[number];

export function costWindow(raw: string | string[] | undefined): CostWindow {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return (COST_WINDOWS as readonly number[]).includes(value) ? (value as CostWindow) : 30;
}

export type Spend = {
  aiCents: number;
  aiCalls: number;
  aiTokens: number;
  aiFailed: number;
  creativeCents: number;
  creativeCredits: number;
  /** Narration: what the voice provider charged, and the seconds of audio it produced. */
  speechCents: number;
  speechSeconds: number;
  emails: number;
  emailsFailed: number;
  /** Held now, not spent over the window: storage is a stock, the rest are flows. */
  storageBytes: number;
};

export const emptySpend = (): Spend => ({ aiCents: 0, aiCalls: 0, aiTokens: 0, aiFailed: 0, creativeCents: 0, creativeCredits: 0, speechCents: 0, speechSeconds: 0, emails: 0, emailsFailed: 0, storageBytes: 0 });

/** Revenue over a window, from a monthly figure: thirty days to the month, whatever the calendar says. */
export const revenueOver = (mrrCents: number, days: number) => Math.round((mrrCents * days) / 30);

const tokens = sql<number>`coalesce(sum(coalesce(${s.aiJobs.inputTokens}, 0) + coalesce(${s.aiJobs.outputTokens}, 0)), 0)`;
const aiCents = sql<number>`coalesce(sum(${s.aiJobs.costCents}), 0)`;
const aiFailed = sql<number>`count(*) filter (where ${s.aiJobs.status} = 'FAILED')`;
const creativeCents = sql<number>`coalesce(sum(${s.creativeCosts.costCents}), 0)`;
const creativeCredits = sql<number>`coalesce(sum(${s.creativeCosts.credits}), 0)`;
const speechCents = sql<number>`coalesce(sum(${s.speechUsage.costCents}), 0)`;
const speechSeconds = sql<number>`coalesce(sum(${s.speechUsage.seconds}) filter (where ${s.speechUsage.operation} = 'tts'), 0)`;
const dayOf = (column: AnyColumn) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;
const monthOf = (column: AnyColumn) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM')`;

/* ── Spend, by workspace ──────────────────────────────────────────────────────────────────── */

async function storageByWorkspace(): Promise<Map<string, number>> {
  const [assets, variants, creative] = await Promise.all([
    db.select({ id: s.mediaAssets.organizationId, bytes: sql<number>`coalesce(sum(${s.mediaAssets.sizeBytes}), 0)` }).from(s.mediaAssets).groupBy(s.mediaAssets.organizationId),
    db
      .select({ id: s.mediaAssets.organizationId, bytes: sql<number>`coalesce(sum(${s.mediaVariants.sizeBytes}), 0)` })
      .from(s.mediaVariants)
      .innerJoin(s.mediaAssets, eq(s.mediaAssets.id, s.mediaVariants.assetId))
      .groupBy(s.mediaAssets.organizationId),
    db.select({ id: s.creativeAssets.organizationId, bytes: sql<number>`coalesce(sum(${s.creativeAssets.sizeBytes}), 0)` }).from(s.creativeAssets).groupBy(s.creativeAssets.organizationId),
  ]);
  const total = new Map<string, number>();
  for (const row of [...assets, ...variants, ...creative]) {
    const key = row.id ?? NONE;
    total.set(key, (total.get(key) ?? 0) + num(row.bytes));
  }
  return total;
}

/** Every workspace's spend over the last `days`, keyed by workspace id; `""` is nobody's. */
export async function spendByWorkspace(days: number): Promise<Map<string, Spend>> {
  const from = since(days);
  const [ai, creative, speech, email, storage] = await Promise.all([
    db
      .select({ id: s.aiJobs.organizationId, cents: aiCents, calls: count(), tokens, failed: aiFailed })
      .from(s.aiJobs)
      .where(gte(s.aiJobs.createdAt, from))
      .groupBy(s.aiJobs.organizationId),
    db
      .select({ id: s.creativeCosts.organizationId, cents: creativeCents, credits: creativeCredits })
      .from(s.creativeCosts)
      .where(gte(s.creativeCosts.createdAt, from))
      .groupBy(s.creativeCosts.organizationId),
    db
      .select({ id: s.speechUsage.organizationId, cents: speechCents, seconds: speechSeconds })
      .from(s.speechUsage)
      .where(gte(s.speechUsage.createdAt, from))
      .groupBy(s.speechUsage.organizationId),
    db
      .select({
        id: s.emailLog.organizationId,
        sent: sql<number>`count(*) filter (where ${s.emailLog.status} = 'SENT')`,
        failed: sql<number>`count(*) filter (where ${s.emailLog.status} = 'FAILED')`,
      })
      .from(s.emailLog)
      .where(gte(s.emailLog.createdAt, from))
      .groupBy(s.emailLog.organizationId),
    storageByWorkspace(),
  ]);

  const spend = new Map<string, Spend>();
  const line = (id: string | null) => {
    const key = id ?? NONE;
    const existing = spend.get(key);
    if (existing) return existing;
    const fresh = emptySpend();
    spend.set(key, fresh);
    return fresh;
  };
  for (const row of ai) Object.assign(line(row.id), { aiCents: num(row.cents), aiCalls: num(row.calls), aiTokens: num(row.tokens), aiFailed: num(row.failed) });
  for (const row of creative) Object.assign(line(row.id), { creativeCents: num(row.cents), creativeCredits: num(row.credits) });
  for (const row of speech) Object.assign(line(row.id), { speechCents: num(row.cents), speechSeconds: num(row.seconds) });
  for (const row of email) Object.assign(line(row.id), { emails: num(row.sent), emailsFailed: num(row.failed) });
  for (const [id, bytes] of storage) line(id || null).storageBytes = bytes;
  return spend;
}

/* ── Spend, by person ─────────────────────────────────────────────────────────────────────── */

type PersonAi = { userId: string; organizationId: string | null; cents: number; calls: number; tokens: number };
type PersonCreative = { userId: string; organizationId: string | null; cents: number; credits: number };

async function aiByPerson(from: Date, organizationId?: string): Promise<PersonAi[]> {
  const rows = await db
    .select({ userId: s.aiJobs.userId, organizationId: s.aiJobs.organizationId, cents: aiCents, calls: count(), tokens })
    .from(s.aiJobs)
    .where(and(gte(s.aiJobs.createdAt, from), isNotNull(s.aiJobs.userId), organizationId ? eq(s.aiJobs.organizationId, organizationId) : undefined))
    .groupBy(s.aiJobs.userId, s.aiJobs.organizationId);
  return rows.map((row) => ({ userId: row.userId as string, organizationId: row.organizationId, cents: num(row.cents), calls: num(row.calls), tokens: num(row.tokens) }));
}

async function creativeByPerson(from: Date, organizationId?: string): Promise<PersonCreative[]> {
  const rows = await db
    .select({ userId: s.creativePacks.createdById, organizationId: s.creativeCosts.organizationId, cents: creativeCents, credits: creativeCredits })
    .from(s.creativeCosts)
    .innerJoin(s.creativePacks, eq(s.creativePacks.id, s.creativeCosts.packId))
    .where(and(gte(s.creativeCosts.createdAt, from), isNotNull(s.creativePacks.createdById), organizationId ? eq(s.creativeCosts.organizationId, organizationId) : undefined))
    .groupBy(s.creativePacks.createdById, s.creativeCosts.organizationId);
  return rows.map((row) => ({ userId: row.userId as string, organizationId: row.organizationId, cents: num(row.cents), credits: num(row.credits) }));
}

/* ── The platform's bill ──────────────────────────────────────────────────────────────────── */

export type WorkspaceSpend = Spend & {
  organizationId: string;
  name: string;
  slug: string;
  planName: string | null;
  status: string;
  currency: string;
  mrrCents: number;
  revenueCents: number;
  marginCents: number;
};

export type PersonSpend = { userId: string; name: string; email: string; role: Role; aiCents: number; aiCalls: number; aiTokens: number; creativeCents: number; workspaces: string[] };
export type ModelSpend = { provider: string; model: string; calls: number; cents: number; tokens: number; failed: number };
export type ServiceSpend = { service: string; calls: number; cents: number; tokens: number };
export type DaySpend = { day: string; aiCents: number; creativeCents: number; speechCents: number; calls: number };

export type CostsBreakdown = {
  days: CostWindow;
  totals: Spend & { revenueCents: number; marginCents: number; unattributedAiCents: number; workspacesWithSpend: number };
  byWorkspace: WorkspaceSpend[];
  byPerson: PersonSpend[];
  byModel: ModelSpend[];
  byService: ServiceSpend[];
  byDay: DaySpend[];
};

/** Every day from `from` to today, so a chart has a bar for the quiet days too. */
function eachDay(from: Date, to = new Date()): string[] {
  const days: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cursor <= end) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function costsBreakdown(days: CostWindow = 30): Promise<CostsBreakdown> {
  const from = since(days);
  const [subs, spend, people, creativePeople, models, services, aiDays, creativeDays, speechDays] = await Promise.all([
    subscriptionRows(),
    spendByWorkspace(days),
    aiByPerson(from),
    creativeByPerson(from),
    db
      .select({ provider: s.aiJobs.provider, model: s.aiJobs.model, calls: count(), cents: aiCents, tokens, failed: aiFailed })
      .from(s.aiJobs)
      .where(gte(s.aiJobs.createdAt, from))
      .groupBy(s.aiJobs.provider, s.aiJobs.model)
      .orderBy(desc(aiCents)),
    db
      .select({ service: s.aiJobs.service, calls: count(), cents: aiCents, tokens })
      .from(s.aiJobs)
      .where(gte(s.aiJobs.createdAt, from))
      .groupBy(s.aiJobs.service)
      .orderBy(desc(aiCents)),
    db
      .select({ day: dayOf(s.aiJobs.createdAt), cents: aiCents, calls: count() })
      .from(s.aiJobs)
      .where(gte(s.aiJobs.createdAt, from))
      .groupBy(dayOf(s.aiJobs.createdAt)),
    db
      .select({ day: dayOf(s.creativeCosts.createdAt), cents: creativeCents })
      .from(s.creativeCosts)
      .where(gte(s.creativeCosts.createdAt, from))
      .groupBy(dayOf(s.creativeCosts.createdAt)),
    db
      .select({ day: dayOf(s.speechUsage.createdAt), cents: speechCents })
      .from(s.speechUsage)
      .where(gte(s.speechUsage.createdAt, from))
      .groupBy(dayOf(s.speechUsage.createdAt)),
  ]);

  const byWorkspace: WorkspaceSpend[] = subs
    .map((sub) => {
      const line = spend.get(sub.organizationId) ?? emptySpend();
      const revenueCents = revenueOver(sub.mrrCents, days);
      return {
        ...line,
        organizationId: sub.organizationId,
        name: sub.name,
        slug: sub.slug,
        planName: sub.planName,
        status: sub.status,
        currency: sub.currency,
        mrrCents: sub.mrrCents,
        revenueCents,
        marginCents: revenueCents - line.aiCents - line.creativeCents - line.speechCents,
      };
    })
    .sort((a, b) => b.aiCents + b.creativeCents + b.speechCents - (a.aiCents + a.creativeCents + a.speechCents) || a.name.localeCompare(b.name));

  const names = new Map(subs.map((sub) => [sub.organizationId, sub.name]));
  const personIds = [...new Set([...people.map((row) => row.userId), ...creativePeople.map((row) => row.userId)])];
  const users = personIds.length ? await db.select({ id: s.users.id, name: s.users.name, email: s.users.email, role: s.users.role }).from(s.users).where(inArray(s.users.id, personIds)) : [];
  const byPersonMap = new Map<string, PersonSpend>();
  for (const user of users) byPersonMap.set(user.id, { userId: user.id, name: user.name, email: user.email, role: user.role, aiCents: 0, aiCalls: 0, aiTokens: 0, creativeCents: 0, workspaces: [] });
  const addWorkspace = (person: PersonSpend, organizationId: string | null) => {
    const name = organizationId ? names.get(organizationId) : null;
    if (name && !person.workspaces.includes(name)) person.workspaces.push(name);
  };
  for (const row of people) {
    const person = byPersonMap.get(row.userId);
    if (!person) continue;
    person.aiCents += row.cents;
    person.aiCalls += row.calls;
    person.aiTokens += row.tokens;
    addWorkspace(person, row.organizationId);
  }
  for (const row of creativePeople) {
    const person = byPersonMap.get(row.userId);
    if (!person) continue;
    person.creativeCents += row.cents;
    addWorkspace(person, row.organizationId);
  }
  const byPerson = [...byPersonMap.values()].sort((a, b) => b.aiCents + b.creativeCents - (a.aiCents + a.creativeCents) || a.name.localeCompare(b.name));

  const aiDayMap = new Map(aiDays.map((row) => [row.day, row]));
  const creativeDayMap = new Map(creativeDays.map((row) => [row.day, row]));
  const speechDayMap = new Map(speechDays.map((row) => [row.day, row]));
  const byDay: DaySpend[] = eachDay(from).map((day) => ({ day, aiCents: num(aiDayMap.get(day)?.cents), creativeCents: num(creativeDayMap.get(day)?.cents), speechCents: num(speechDayMap.get(day)?.cents), calls: num(aiDayMap.get(day)?.calls) }));

  const totals = { ...emptySpend(), revenueCents: 0, marginCents: 0, unattributedAiCents: num(spend.get(NONE)?.aiCents), workspacesWithSpend: 0 };
  for (const [, line] of spend) {
    totals.aiCents += line.aiCents;
    totals.aiCalls += line.aiCalls;
    totals.aiTokens += line.aiTokens;
    totals.aiFailed += line.aiFailed;
    totals.creativeCents += line.creativeCents;
    totals.creativeCredits += line.creativeCredits;
    totals.speechCents += line.speechCents;
    totals.speechSeconds += line.speechSeconds;
    totals.emails += line.emails;
    totals.emailsFailed += line.emailsFailed;
    totals.storageBytes += line.storageBytes;
  }
  totals.revenueCents = byWorkspace.reduce((total, row) => total + row.revenueCents, 0);
  totals.marginCents = totals.revenueCents - totals.aiCents - totals.creativeCents - totals.speechCents;
  totals.workspacesWithSpend = byWorkspace.filter((row) => row.aiCents + row.creativeCents + row.speechCents > 0 || row.emails > 0).length;

  return {
    days,
    totals,
    byWorkspace,
    byPerson,
    byModel: models.map((row) => ({ provider: row.provider, model: row.model, calls: num(row.calls), cents: num(row.cents), tokens: num(row.tokens), failed: num(row.failed) })),
    byService: services.map((row) => ({ service: row.service, calls: num(row.calls), cents: num(row.cents), tokens: num(row.tokens) })),
    byDay,
  };
}

/** The customer table, as a file somebody can open in a spreadsheet. */
export function costsCsv(breakdown: CostsBreakdown): string {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = ["workspace", "slug", "plan", "status", "currency", "revenue", "ai_cost", "ai_calls", "ai_tokens", "ai_failed", "creative_cost", "creative_credits", "speech_cost", "speech_seconds", "emails_sent", "emails_failed", "storage_bytes", "margin"];
  const rows = breakdown.byWorkspace.map((row) => [
    row.name,
    row.slug,
    row.planName ?? "",
    row.status,
    row.currency,
    (row.revenueCents / 100).toFixed(2),
    (row.aiCents / 100).toFixed(4),
    row.aiCalls,
    row.aiTokens,
    row.aiFailed,
    (row.creativeCents / 100).toFixed(4),
    row.creativeCredits,
    row.speechCents,
    Math.round(row.speechSeconds),
    row.emails,
    row.emailsFailed,
    row.storageBytes,
    (row.marginCents / 100).toFixed(2),
  ]);
  return [header, ...rows].map((line) => line.map(cell).join(",")).join("\n") + "\n";
}

/* ── One customer ─────────────────────────────────────────────────────────────────────────── */

export type WorkspaceMember = {
  userId: string;
  name: string;
  email: string;
  platformRole: Role;
  role: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  joinedAt: Date;
  aiCents30: number;
  aiCalls30: number;
  actions30: number;
};

export type WorkspaceSheet = {
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
    status: string;
    website: string | null;
    description: string | null;
    logoUrl: string | null;
    locale: string;
    timezone: string;
    country: string | null;
    createdAt: Date;
    onboardedAt: Date | null;
    readerPaymentsConnected: boolean;
  };
  subscription: SubscriptionRow;
  usage: Awaited<ReturnType<typeof usageReport>>["lines"];
  counts: {
    members: number;
    publications: number;
    paidPublications: number;
    editions: number;
    publishedEditions: number;
    subscribers: number;
    payingReaders: number;
    contributors: number;
    media: number;
    jobsFailed7: number;
  };
  spend30: Spend;
  spendAll: Spend;
  revenue30Cents: number;
  margin30Cents: number;
  byMonth: { month: string; aiCents: number; creativeCents: number; emails: number; published: number }[];
  members: WorkspaceMember[];
  activity: LogEntry[];
  invoices: { rows: InvoiceRow[]; error: string | null } | null;
};

/** Six months back, as 'YYYY-MM' keys ending with this month. */
function recentMonths(n = 6): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

export async function workspaceSheet(organizationId: string): Promise<WorkspaceSheet | null> {
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId) });
  if (!organization) return null;
  const month = since(30);
  const week = since(7);
  const months = recentMonths(6);
  const monthsFrom = new Date(`${months[0]}-01T00:00:00Z`);

  const [subs, spend30All, spendAll, usage, members, memberAi, memberActions, activity, invoices, counts, byMonthAi, byMonthCreative, byMonthEmail, byMonthPublished] = await Promise.all([
    subscriptionRows(),
    spendByWorkspace(30),
    spendByWorkspace(365 * 20),
    usageReport(organizationId),
    db
      .select({
        userId: s.users.id,
        name: s.users.name,
        email: s.users.email,
        platformRole: s.users.role,
        role: s.organizationMembers.role,
        isActive: s.users.isActive,
        lastLoginAt: s.users.lastLoginAt,
        joinedAt: s.organizationMembers.createdAt,
      })
      .from(s.organizationMembers)
      .innerJoin(s.users, eq(s.users.id, s.organizationMembers.userId))
      .where(eq(s.organizationMembers.organizationId, organizationId))
      .orderBy(s.users.name),
    aiByPerson(month, organizationId),
    db
      .select({ userId: s.auditLog.userId, n: count() })
      .from(s.auditLog)
      .where(and(eq(s.auditLog.organizationId, organizationId), gte(s.auditLog.createdAt, month), isNotNull(s.auditLog.userId)))
      .groupBy(s.auditLog.userId),
    readLogs({ organizationId, sinceDays: 30 }, 40),
    invoicesForWorkspace(organizationId),
    Promise.all([
      db.select({ n: count() }).from(s.organizationMembers).where(eq(s.organizationMembers.organizationId, organizationId)),
      db.select({ n: count(), paid: sql<number>`count(*) filter (where ${s.publications.access} = 'paid')` }).from(s.publications).where(eq(s.publications.organizationId, organizationId)),
      db.select({ n: count(), published: sql<number>`count(*) filter (where ${s.editions.status} = 'PUBLISHED')` }).from(s.editions).where(eq(s.editions.organizationId, organizationId)),
      db.select({ n: count() }).from(s.subscribers).where(and(eq(s.subscribers.organizationId, organizationId), eq(s.subscribers.status, "SUBSCRIBED"))),
      db
        .select({ n: count() })
        .from(s.publicationSubscriptions)
        .innerJoin(s.publications, eq(s.publications.id, s.publicationSubscriptions.publicationId))
        .where(and(eq(s.publications.organizationId, organizationId), eq(s.publicationSubscriptions.isActive, true), eq(s.publicationSubscriptions.paymentStatus, "active"))),
      db.select({ n: count() }).from(s.contributors).where(eq(s.contributors.organizationId, organizationId)),
      db.select({ n: count() }).from(s.mediaAssets).where(eq(s.mediaAssets.organizationId, organizationId)),
      db
        .select({ n: count() })
        .from(s.jobs)
        .where(and(eq(s.jobs.organizationId, organizationId), inArray(s.jobs.status, ["FAILED", "DEAD"]), sql`coalesce(${s.jobs.finishedAt}, ${s.jobs.createdAt}) >= ${week.toISOString()}::timestamptz`)),
    ]),
    db
      .select({ month: monthOf(s.aiJobs.createdAt), cents: aiCents })
      .from(s.aiJobs)
      .where(and(eq(s.aiJobs.organizationId, organizationId), gte(s.aiJobs.createdAt, monthsFrom)))
      .groupBy(monthOf(s.aiJobs.createdAt)),
    db
      .select({ month: monthOf(s.creativeCosts.createdAt), cents: creativeCents })
      .from(s.creativeCosts)
      .where(and(eq(s.creativeCosts.organizationId, organizationId), gte(s.creativeCosts.createdAt, monthsFrom)))
      .groupBy(monthOf(s.creativeCosts.createdAt)),
    db
      .select({ month: monthOf(s.emailLog.createdAt), n: sql<number>`count(*) filter (where ${s.emailLog.status} = 'SENT')` })
      .from(s.emailLog)
      .where(and(eq(s.emailLog.organizationId, organizationId), gte(s.emailLog.createdAt, monthsFrom)))
      .groupBy(monthOf(s.emailLog.createdAt)),
    db
      .select({ month: monthOf(s.editions.publishedAt), n: count() })
      .from(s.editions)
      .where(and(eq(s.editions.organizationId, organizationId), isNotNull(s.editions.publishedAt), gte(s.editions.publishedAt, monthsFrom)))
      .groupBy(monthOf(s.editions.publishedAt)),
  ]);

  const subscription = subs.find((sub) => sub.organizationId === organizationId);
  if (!subscription) return null;
  const spend30 = spend30All.get(organizationId) ?? emptySpend();
  const aiByUser = new Map(memberAi.map((row) => [row.userId, row]));
  const actionsByUser = new Map(memberActions.map((row) => [row.userId as string, num(row.n)]));
  const [[memberCount], [publicationCount], [editionCount], [subscriberCount], [payingReaders], [contributorCount], [mediaCount], [failedJobs]] = counts;
  const revenue30Cents = revenueOver(subscription.mrrCents, 30);
  const inMonth = <T extends { month: string }>(rows: T[], key: string): T | undefined => rows.find((row) => row.month === key);

  return {
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      type: organization.type,
      status: organization.status,
      website: organization.website,
      description: organization.description,
      logoUrl: organization.logoUrl,
      locale: organization.locale,
      timezone: organization.timezone,
      country: organization.country,
      createdAt: organization.createdAt,
      onboardedAt: organization.onboardedAt,
      readerPaymentsConnected: Boolean(organization.readerPayments),
    },
    subscription,
    usage: usage.lines,
    counts: {
      members: num(memberCount.n),
      publications: num(publicationCount.n),
      paidPublications: num(publicationCount.paid),
      editions: num(editionCount.n),
      publishedEditions: num(editionCount.published),
      subscribers: num(subscriberCount.n),
      payingReaders: num(payingReaders.n),
      contributors: num(contributorCount.n),
      media: num(mediaCount.n),
      jobsFailed7: num(failedJobs.n),
    },
    spend30,
    spendAll: spendAll.get(organizationId) ?? emptySpend(),
    revenue30Cents,
    margin30Cents: revenue30Cents - spend30.aiCents - spend30.creativeCents,
    byMonth: months.map((key) => ({
      month: key,
      aiCents: num(inMonth(byMonthAi, key)?.cents),
      creativeCents: num(inMonth(byMonthCreative, key)?.cents),
      emails: num(inMonth(byMonthEmail, key)?.n),
      published: num(inMonth(byMonthPublished, key)?.n),
    })),
    members: members.map((member) => ({
      ...member,
      aiCents30: aiByUser.get(member.userId)?.cents ?? 0,
      aiCalls30: aiByUser.get(member.userId)?.calls ?? 0,
      actions30: actionsByUser.get(member.userId) ?? 0,
    })),
    activity,
    invoices,
  };
}

/* ── One person ───────────────────────────────────────────────────────────────────────────── */

export type UserSheet = {
  user: { id: string; name: string; email: string; role: Role; isActive: boolean; createdAt: Date; lastLoginAt: Date | null; avatarUrl: string | null; campus: string | null };
  workspaces: { organizationId: string; name: string; slug: string; role: string; isDefault: boolean; planName: string | null; joinedAt: Date }[];
  sessions: { active: number; lastSeenAt: Date | null; agents: string[] };
  activity: {
    actions30: number;
    logins30: number;
    byAction: { action: string; count: number; lastAt: Date }[];
    byDay: { day: string; count: number }[];
    recent: { id: string; at: Date; action: string; workspace: string | null; entityType: string | null; detail: string | null }[];
  };
  spend: {
    ai30Cents: number;
    ai30Calls: number;
    aiAllCents: number;
    creative30Cents: number;
    byWorkspace: { organizationId: string | null; name: string | null; aiCents: number; aiCalls: number }[];
  };
};

/** A line of metadata a person can read: the string values, nothing nested. */
function summarise(metadata: Record<string, unknown>): string | null {
  const parts = Object.entries(metadata)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}: ${String(value)}`);
  return parts.length ? parts.join(" · ").slice(0, 160) : null;
}

export async function userSheet(userId: string): Promise<UserSheet | null> {
  const [row] = await db
    .select({
      id: s.users.id,
      name: s.users.name,
      email: s.users.email,
      role: s.users.role,
      isActive: s.users.isActive,
      createdAt: s.users.createdAt,
      lastLoginAt: s.users.lastLoginAt,
      avatarUrl: s.users.avatarUrl,
      campus: s.campuses.name,
    })
    .from(s.users)
    .leftJoin(s.campuses, eq(s.campuses.id, s.users.campusId))
    .where(eq(s.users.id, userId))
    .limit(1);
  if (!row) return null;
  const month = since(30);
  const now = new Date();

  const [workspaces, sessions, [actions], byAction, byDayRows, recent, ai30, [aiAll], [creative30]] = await Promise.all([
    db
      .select({
        organizationId: s.organizations.id,
        name: s.organizations.name,
        slug: s.organizations.slug,
        role: s.organizationMembers.role,
        isDefault: s.organizationMembers.isDefault,
        planName: s.plans.name,
        joinedAt: s.organizationMembers.createdAt,
      })
      .from(s.organizationMembers)
      .innerJoin(s.organizations, eq(s.organizations.id, s.organizationMembers.organizationId))
      .leftJoin(s.organizationSubscriptions, eq(s.organizationSubscriptions.organizationId, s.organizations.id))
      .leftJoin(s.plans, eq(s.plans.id, s.organizationSubscriptions.planId))
      .where(eq(s.organizationMembers.userId, userId))
      .orderBy(s.organizations.name),
    db
      .select({ active: sql<number>`count(*) filter (where ${s.sessions.expiresAt} > ${now.toISOString()}::timestamptz)`, lastSeenAt: sql<Date | string | null>`max(${s.sessions.lastSeenAt})`, agents: sql<string[]>`array_remove(array_agg(distinct ${s.sessions.userAgent}), null)` })
      .from(s.sessions)
      .where(eq(s.sessions.userId, userId)),
    db
      .select({ total: count(), logins: sql<number>`count(*) filter (where ${s.auditLog.action} = 'auth.login')` })
      .from(s.auditLog)
      .where(and(eq(s.auditLog.userId, userId), gte(s.auditLog.createdAt, month))),
    db
      .select({ action: s.auditLog.action, n: count(), lastAt: sql<Date | string>`max(${s.auditLog.createdAt})` })
      .from(s.auditLog)
      .where(and(eq(s.auditLog.userId, userId), gte(s.auditLog.createdAt, month)))
      .groupBy(s.auditLog.action)
      .orderBy(desc(count()))
      .limit(10),
    db
      .select({ day: dayOf(s.auditLog.createdAt), n: count() })
      .from(s.auditLog)
      .where(and(eq(s.auditLog.userId, userId), gte(s.auditLog.createdAt, month)))
      .groupBy(dayOf(s.auditLog.createdAt)),
    db
      .select({ id: s.auditLog.id, at: s.auditLog.createdAt, action: s.auditLog.action, workspace: s.organizations.name, entityType: s.auditLog.entityType, metadata: s.auditLog.metadata })
      .from(s.auditLog)
      .leftJoin(s.organizations, eq(s.organizations.id, s.auditLog.organizationId))
      .where(eq(s.auditLog.userId, userId))
      .orderBy(desc(s.auditLog.createdAt))
      .limit(25),
    db
      .select({ organizationId: s.aiJobs.organizationId, name: s.organizations.name, cents: aiCents, calls: count() })
      .from(s.aiJobs)
      .leftJoin(s.organizations, eq(s.organizations.id, s.aiJobs.organizationId))
      .where(and(eq(s.aiJobs.userId, userId), gte(s.aiJobs.createdAt, month)))
      .groupBy(s.aiJobs.organizationId, s.organizations.name),
    db.select({ cents: aiCents }).from(s.aiJobs).where(eq(s.aiJobs.userId, userId)),
    db
      .select({ cents: creativeCents })
      .from(s.creativeCosts)
      .innerJoin(s.creativePacks, eq(s.creativePacks.id, s.creativeCosts.packId))
      .where(and(eq(s.creativePacks.createdById, userId), gte(s.creativeCosts.createdAt, month))),
  ]);

  const dayMap = new Map(byDayRows.map((entry) => [entry.day, num(entry.n)]));
  const [session] = sessions;
  const lastSeen = session?.lastSeenAt ? new Date(session.lastSeenAt) : null;

  return {
    user: { ...row, campus: row.campus ?? null },
    workspaces,
    sessions: { active: num(session?.active), lastSeenAt: lastSeen, agents: (session?.agents ?? []).slice(0, 3) },
    activity: {
      actions30: num(actions?.total),
      logins30: num(actions?.logins),
      byAction: byAction.map((entry) => ({ action: entry.action, count: num(entry.n), lastAt: new Date(entry.lastAt) })),
      byDay: eachDay(month).map((day) => ({ day, count: dayMap.get(day) ?? 0 })),
      recent: recent.map((entry) => ({ id: entry.id, at: entry.at, action: entry.action, workspace: entry.workspace ?? null, entityType: entry.entityType ?? null, detail: summarise(entry.metadata ?? {}) })),
    },
    spend: {
      ai30Cents: ai30.reduce((total, entry) => total + num(entry.cents), 0),
      ai30Calls: ai30.reduce((total, entry) => total + num(entry.calls), 0),
      aiAllCents: num(aiAll?.cents),
      creative30Cents: num(creative30?.cents),
      byWorkspace: ai30.map((entry) => ({ organizationId: entry.organizationId, name: entry.name ?? null, aiCents: num(entry.cents), aiCalls: num(entry.calls) })),
    },
  };
}

/** Active sessions of one person, for the "sign out everywhere" button to say how many it ends. */
export async function activeSessionCount(userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(s.sessions).where(and(eq(s.sessions.userId, userId), gt(s.sessions.expiresAt, new Date())));
  return num(row?.n);
}
