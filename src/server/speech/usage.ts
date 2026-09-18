import { and, count, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ForbiddenError } from "@/lib/action-result";
import { resolveEntitlements } from "@/server/billing/entitlements";

/**
 * The speech ledger, and the allowance measured against it.
 *
 * A plan grants minutes of narration a month; the minutes are the seconds of audio the provider
 * produced, summed from these rows. Reading the ledger rather than a counter means a refund, a
 * plan change or a correction takes effect at once, and that a customer's bill and their allowance
 * are one number seen from two sides.
 */

export async function recordSpeechUsage(input: {
  organizationId: string;
  narrationId?: string | null;
  segmentId?: string | null;
  provider: string;
  model?: string | null;
  operation: "tts" | "dialogue" | "clone" | "master";
  quality?: string | null;
  characters?: number;
  seconds?: number;
  costCents: number;
  createdById?: string | null;
}) {
  await db.insert(s.speechUsage).values({
    organizationId: input.organizationId,
    narrationId: input.narrationId ?? null,
    segmentId: input.segmentId ?? null,
    provider: input.provider,
    model: input.model ?? null,
    operation: input.operation,
    quality: input.quality ?? null,
    characters: input.characters ?? 0,
    seconds: input.seconds ?? 0,
    costCents: String(input.costCents),
    createdById: input.createdById ?? null,
  });
  if (input.narrationId) {
    await db
      .update(s.narrations)
      .set({ costCents: sql`${s.narrations.costCents} + ${String(input.costCents)}`, characters: sql`${s.narrations.characters} + ${input.characters ?? 0}`, updatedAt: new Date() })
      .where(eq(s.narrations.id, input.narrationId));
  }
}

function monthStart() {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export async function narrationSecondsThisMonth(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ seconds: sql<number>`coalesce(sum(${s.speechUsage.seconds}), 0)` })
    .from(s.speechUsage)
    .where(and(eq(s.speechUsage.organizationId, organizationId), gte(s.speechUsage.createdAt, monthStart()), eq(s.speechUsage.operation, "tts")));
  return Number(row.seconds);
}

export type NarrationAllowance = { limitMinutes: number | null; usedSeconds: number };

export async function narrationAllowance(organizationId: string): Promise<NarrationAllowance> {
  const plan = await resolveEntitlements(organizationId);
  const raw = (plan.entitlements as Record<string, unknown>).narrationMinutes;
  const limit = raw === null || raw === undefined ? null : Number(raw);
  return { limitMinutes: limit !== null && Number.isFinite(limit) ? limit : null, usedSeconds: await narrationSecondsThisMonth(organizationId) };
}

/** Refuse before the spend, not after: a ledger that records an overrun is an audit trail, not a limit. */
export async function assertNarrationAllowance(organizationId: string, estimatedSeconds: number) {
  const allowance = await narrationAllowance(organizationId);
  if (allowance.limitMinutes === null) return allowance;
  const wouldUse = (allowance.usedSeconds + estimatedSeconds) / 60;
  if (wouldUse > allowance.limitMinutes) {
    throw new ForbiddenError(`That would use about ${Math.ceil(wouldUse)} of this month's ${allowance.limitMinutes} minutes of narration.`);
  }
  return allowance;
}

export type SpeechSpend = { cents: number; seconds: number; characters: number; narrations: number };

export async function speechSpend(organizationId: string, days: number): Promise<SpeechSpend> {
  const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [[usage], [made]] = await Promise.all([
    db
      .select({ cents: sql<number>`coalesce(sum(${s.speechUsage.costCents}), 0)`, seconds: sql<number>`coalesce(sum(${s.speechUsage.seconds}), 0)`, characters: sql<number>`coalesce(sum(${s.speechUsage.characters}), 0)` })
      .from(s.speechUsage)
      .where(and(eq(s.speechUsage.organizationId, organizationId), gte(s.speechUsage.createdAt, from))),
    db
      .select({ n: count() })
      .from(s.narrations)
      .where(and(eq(s.narrations.organizationId, organizationId), gte(s.narrations.createdAt, from))),
  ]);
  return { cents: Number(usage.cents), seconds: Number(usage.seconds), characters: Number(usage.characters), narrations: Number(made.n) };
}
