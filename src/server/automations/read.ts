/**
 * Read-side adapter for the Automations centre. The scheduler (src/server/campaigns/scheduler.ts)
 * owns the logic; this module only shapes its output for the screen so the page never depends on
 * scheduler internals directly.
 */
import { desc, eq, and, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { automationRuns, editions } from "@/server/db/schema";
import { describeAutomations, type AutomationDescription } from "@/server/campaigns/scheduler";
import type { AutomationKey } from "@/server/campaigns/settings";

export type AutomationStep = (typeof automationRuns.$inferSelect)["step"];

/** Which automation_runs steps feed each automation card. */
export const STEPS_BY_AUTOMATION: Record<AutomationKey, AutomationStep[]> = {
  editionCreation: ["EDITION_CREATION"],
  contributionRequest: ["CAMPAIGN_OPEN"],
  reminder1: ["REMINDER_1"],
  reminder2: ["REMINDER_2"],
  gracePeriod: ["GRACE_PERIOD", "CAMPAIGN_CLOSE"],
  aiProcessing: ["AI_PROCESSING"],
  editorialAlert: ["EDITORIAL_ALERT"],
  coverageCheck: ["COVERAGE_CHECK"],
  deadlineAlert: ["DEADLINE_ALERT"],
};

export const STEP_LABELS: Record<AutomationStep, string> = {
  EDITION_CREATION: "Edition creation",
  CAMPAIGN_OPEN: "Contribution request",
  REMINDER_1: "Reminder #1",
  REMINDER_2: "Reminder #2",
  GRACE_PERIOD: "Grace period",
  CAMPAIGN_CLOSE: "Campaign close",
  AI_PROCESSING: "AI processing",
  EDITORIAL_ALERT: "Editorial alert",
  COVERAGE_CHECK: "Coverage check",
  DEADLINE_ALERT: "Deadline alert",
};

export type LastRun = { id: string; step: AutomationStep; status: string; triggeredBy: string; finishedAt: Date | null; startedAt: Date | null; scheduledFor: Date | null; editionId: string | null; editionLabel: string | null; error: string | null; summary: Record<string, unknown> };

export type AutomationCard = AutomationDescription & { steps: AutomationStep[]; lastRun: LastRun | null };

export async function automationOverview(now = new Date()) {
  const described = await describeAutomations(now);
  const latest = await db
    .selectDistinctOn([automationRuns.step], {
      id: automationRuns.id,
      step: automationRuns.step,
      status: automationRuns.status,
      triggeredBy: automationRuns.triggeredBy,
      finishedAt: automationRuns.finishedAt,
      startedAt: automationRuns.startedAt,
      scheduledFor: automationRuns.scheduledFor,
      editionId: automationRuns.editionId,
      editionLabel: editions.label,
      error: automationRuns.error,
      summary: automationRuns.summary,
    })
    .from(automationRuns)
    .leftJoin(editions, eq(editions.id, automationRuns.editionId))
    .orderBy(automationRuns.step, desc(automationRuns.createdAt));
  const byStep = new Map(latest.map((r) => [r.step, r]));
  const cards: AutomationCard[] = described.items.map((item) => {
    const steps = STEPS_BY_AUTOMATION[item.key];
    const runs = steps.map((st) => byStep.get(st)).filter((r): r is LastRun => !!r);
    runs.sort((a, b) => (b.finishedAt ?? b.startedAt ?? new Date(0)).getTime() - (a.finishedAt ?? a.startedAt ?? new Date(0)).getTime());
    return { ...item, steps, lastRun: runs[0] ?? null };
  });
  return { cards, defaults: described.defaults, toggles: described.toggles };
}

export type RunFilters = { editionId?: string; step?: string; status?: string; triggeredBy?: string };

export async function automationRunsTable(filters: RunFilters = {}, limit = 200) {
  const where: SQL[] = [];
  if (filters.editionId) where.push(eq(automationRuns.editionId, filters.editionId));
  if (filters.step) where.push(sql`${automationRuns.step}::text = ${filters.step}`);
  if (filters.status) where.push(eq(automationRuns.status, filters.status));
  if (filters.triggeredBy) where.push(eq(automationRuns.triggeredBy, filters.triggeredBy));
  const rows = await db
    .select({ run: automationRuns, editionLabel: editions.label })
    .from(automationRuns)
    .leftJoin(editions, eq(editions.id, automationRuns.editionId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(sql`coalesce(${automationRuns.finishedAt}, ${automationRuns.startedAt}, ${automationRuns.scheduledFor}, ${automationRuns.createdAt})`))
    .limit(limit);
  return rows.map((r) => ({ ...r.run, editionLabel: r.editionLabel }));
}

export type AutomationRunRow = Awaited<ReturnType<typeof automationRunsTable>>[number];

export async function runFilterOptions() {
  const [statuses, editionRows] = await Promise.all([
    db.selectDistinct({ status: automationRuns.status }).from(automationRuns).orderBy(automationRuns.status),
    db.select({ id: editions.id, label: editions.label }).from(editions).orderBy(desc(editions.year), desc(editions.month)),
  ]);
  return { statuses: statuses.map((r) => r.status), editions: editionRows };
}
