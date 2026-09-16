import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiJobs, editions } from "@/server/db/schema";
import { env } from "@/server/env";

export type CostBucket = { service?: string; model?: string; calls: number; costCents: number; tokens: number };
export type EditionAiCost = { editionId: string; totalCents: number; totalTokens: number; calls: number; cachedCalls: number; failedCalls: number; byService: (CostBucket & { service: string })[]; byModel: (CostBucket & { model: string })[] };

const round4 = (n: number) => Math.round(n * 10000) / 10000;

async function aggregate(where: ReturnType<typeof and>) {
  const [totals] = await db
    .select({ calls: sql<number>`count(*)::int`, cached: sql<number>`count(*) filter (where ${aiJobs.cached})::int`, failed: sql<number>`count(*) filter (where ${aiJobs.status} = 'FAILED')::int`, cost: sql<number>`coalesce(sum(${aiJobs.costCents}), 0)::float`, tokens: sql<number>`coalesce(sum(coalesce(${aiJobs.inputTokens}, 0) + coalesce(${aiJobs.outputTokens}, 0)), 0)::int` })
    .from(aiJobs)
    .where(where);
  const byService = await db
    .select({ service: aiJobs.service, calls: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${aiJobs.costCents}), 0)::float`, tokens: sql<number>`coalesce(sum(coalesce(${aiJobs.inputTokens}, 0) + coalesce(${aiJobs.outputTokens}, 0)), 0)::int` })
    .from(aiJobs)
    .where(where)
    .groupBy(aiJobs.service)
    .orderBy(sql`sum(${aiJobs.costCents}) desc nulls last`);
  const byModel = await db
    .select({ model: aiJobs.model, calls: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${aiJobs.costCents}), 0)::float`, tokens: sql<number>`coalesce(sum(coalesce(${aiJobs.inputTokens}, 0) + coalesce(${aiJobs.outputTokens}, 0)), 0)::int` })
    .from(aiJobs)
    .where(where)
    .groupBy(aiJobs.model)
    .orderBy(sql`sum(${aiJobs.costCents}) desc nulls last`);
  return {
    totalCents: round4(Number(totals?.cost ?? 0)),
    totalTokens: Number(totals?.tokens ?? 0),
    calls: Number(totals?.calls ?? 0),
    cachedCalls: Number(totals?.cached ?? 0),
    failedCalls: Number(totals?.failed ?? 0),
    byService: byService.map((r) => ({ service: r.service, calls: Number(r.calls), costCents: round4(Number(r.cost)), tokens: Number(r.tokens) })),
    byModel: byModel.map((r) => ({ model: r.model, calls: Number(r.calls), costCents: round4(Number(r.cost)), tokens: Number(r.tokens) })),
  };
}

/** AI spend of one edition, by service and by model (euro cents, estimated from the pricing table). */
export async function editionAiCost(editionId: string): Promise<EditionAiCost> {
  const agg = await aggregate(and(eq(aiJobs.editionId, editionId)));
  return { editionId, ...agg };
}

export type MonthlyAiCost = Omit<EditionAiCost, "editionId"> & { month: string; from: Date; to: Date; budgetCents: number; budgetRatio: number; byEdition: { editionId: string | null; label: string | null; calls: number; costCents: number }[] };

/** AI spend of a calendar month (default: the current month) against the configured budget. */
export async function monthlyAiCost(date: Date = new Date()): Promise<MonthlyAiCost> {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const to = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  const where = and(gte(aiJobs.createdAt, from), lt(aiJobs.createdAt, to));
  const agg = await aggregate(where);
  const byEdition = await db
    .select({ editionId: aiJobs.editionId, label: editions.label, calls: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${aiJobs.costCents}), 0)::float` })
    .from(aiJobs)
    .leftJoin(editions, eq(editions.id, aiJobs.editionId))
    .where(where)
    .groupBy(aiJobs.editionId, editions.label)
    .orderBy(sql`sum(${aiJobs.costCents}) desc nulls last`);
  const budgetCents = Math.round(env.AI_MAX_MONTHLY_BUDGET_EUR * 100);
  return {
    month: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`,
    from,
    to,
    ...agg,
    budgetCents,
    budgetRatio: budgetCents ? round4(agg.totalCents / budgetCents) : 0,
    byEdition: byEdition.map((r) => ({ editionId: r.editionId, label: r.label, calls: Number(r.calls), costCents: round4(Number(r.cost)) })),
  };
}
