import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { automationRuns, editionSections, editions, emailLog, jobs, notifications, submissionCampaigns, submissionRequests } from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { describeAutomations, listAutomationRuns, runAutomationTick } from "@/server/campaigns/scheduler";
import { JOB_TYPES } from "@/server/jobs/registry";

async function countEmails(template: string, editionId: string) {
  const rows = await db.select({ id: emailLog.id }).from(emailLog).where(and(eq(emailLog.template, template), eq(emailLog.editionId, editionId)));
  return rows.length;
}

describe("automation scheduler", () => {
  let editionId: string;
  const now = new Date("2026-10-09T08:00:00Z"); // after the seeded grace period (8 Oct 23:59 Paris)

  beforeAll(async () => {
    const seed = await ensureSeeded();
    editionId = seed.nextEditionId;
    // This lifecycle test invites the full seeded pool, so it opts into re-inviting the previous
    // edition's people. The month-to-month rotation itself is covered by the selection unit tests.
    await db.update(submissionCampaigns).set({ reinvitePrevious: true }).where(eq(submissionCampaigns.editionId, editionId));
  });

  it("does nothing before the campaign opens", async () => {
    const result = await runAutomationTick({ now: new Date("2026-09-20T10:00:00Z"), triggeredBy: "MANUAL" });
    expect(result.errors).toEqual([]);
    expect(result.ran).toEqual([]);
    expect(result.skipped.some((s) => s.startsWith("EDITION_CREATION:October 2026"))).toBe(true);
  });

  it("catches up on a whole campaign in one pass: open, reminders, close, next edition, coverage", async () => {
    const result = await runAutomationTick({ now, triggeredBy: "SCHEDULER" });
    expect(result.errors).toEqual([]);
    const steps = result.ran.map((r) => r.split(" ")[0]);
    expect(steps).toEqual([
      "EDITION_CREATION:November",
      `CAMPAIGN_OPEN:${editionId}`,
      `REMINDER_1:${editionId}`,
      `REMINDER_2:${editionId}`,
      `GRACE_PERIOD:${editionId}`,
      `CAMPAIGN_CLOSE:${editionId}`,
      `COVERAGE_CHECK:${editionId}`,
    ]);

    const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
    expect(edition?.status).toBe("CLOSED");
    const campaign = await db.query.submissionCampaigns.findFirst({ where: eq(submissionCampaigns.editionId, editionId) });
    expect(campaign?.status).toBe("CLOSED");
    expect(campaign?.closedAt?.toISOString()).toBe(now.toISOString());

    const requests = await db.select().from(submissionRequests).where(eq(submissionRequests.campaignId, campaign!.id));
    expect(requests).toHaveLength(16); // seeded targets have no school-wide key
    expect(requests.every((r) => r.remindedCount === 3)).toBe(true);
    expect(await countEmails("campaign_invitation", editionId)).toBe(16);
    expect(await countEmails("campaign_reminder_1", editionId)).toBe(16);
    expect(await countEmails("campaign_reminder_2", editionId)).toBe(16);
    expect(await countEmails("campaign_grace", editionId)).toBe(16);
    expect(await countEmails("campaign_closed", editionId)).toBe(0);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.idempotencyKey, `edition-process:${editionId}`) });
    expect(job?.type).toBe(JOB_TYPES.EDITION_PROCESS);

    const runs = await listAutomationRuns(editionId);
    expect(runs.map((r) => r.step).sort()).toEqual(["CAMPAIGN_CLOSE", "CAMPAIGN_OPEN", "COVERAGE_CHECK", "EDITION_CREATION", "GRACE_PERIOD", "REMINDER_1", "REMINDER_2"]);
    expect(runs.every((r) => r.status === "SUCCEEDED")).toBe(true);
    const coverageNote = await db.query.notifications.findFirst({ where: and(eq(notifications.type, "LOW_CAMPUS_COVERAGE"), eq(notifications.entityId, editionId)) });
    expect(coverageNote?.title).toBe("No submissions for October 2026");

    // The November edition was created with sections and a scheduled campaign.
    const next = await db.query.editions.findFirst({ where: eq(editions.slug, "issue-3-november-2026") });
    expect(next).toBeTruthy();
    expect(next?.issueNumber).toBe(3);
    expect(next?.label).toBe("November 2026");
    expect(next?.title).toBe("Albert's Deep Dive — Issue N°3");
    expect(next?.status).toBe("UPCOMING");
    expect(next?.publicationTargetAt?.toISOString()).toBe("2026-11-15T09:00:00.000Z"); // 10:00 CET
    const sections = await db.select().from(editionSections).where(eq(editionSections.editionId, next!.id));
    expect(sections).toHaveLength(12);
    const nextCampaign = await db.query.submissionCampaigns.findFirst({ where: eq(submissionCampaigns.editionId, next!.id) });
    expect(nextCampaign?.status).toBe("SCHEDULED");
    expect(nextCampaign?.opensAt.toISOString()).toBe("2026-11-01T08:00:00.000Z"); // 09:00 CET
    expect(nextCampaign?.graceEndsAt.toISOString()).toBe("2026-11-08T22:59:00.000Z");
    expect(nextCampaign?.contributorGroupIds).toEqual(campaign?.contributorGroupIds);
    expect(nextCampaign?.targets).toEqual(campaign?.targets);
    const creationRun = await db.query.automationRuns.findFirst({ where: eq(automationRuns.runKey, `${next!.id}:EDITION_CREATION`) });
    expect(creationRun?.status).toBe("SUCCEEDED");
  });

  it("is a no-op on the second pass", async () => {
    const before = await db.select({ id: emailLog.id }).from(emailLog);
    const result = await runAutomationTick({ now, triggeredBy: "SCHEDULER" });
    expect(result.errors).toEqual([]);
    expect(result.ran).toEqual([]);
    expect(result.skipped.some((s) => s.startsWith("EDITION_CREATION:November 2026"))).toBe(true);
    const after = await db.select({ id: emailLog.id }).from(emailLog);
    expect(after.length).toBe(before.length);
  });

  it("alerts the editors 24 hours before the final review", async () => {
    const later = new Date("2026-10-10T17:00:00Z"); // final review is 11 Oct 16:00Z
    const result = await runAutomationTick({ now: later, triggeredBy: "SCHEDULER" });
    expect(result.errors).toEqual([]);
    expect(result.ran).toEqual([`DEADLINE_ALERT:${editionId}`]);
    const note = await db.query.notifications.findFirst({ where: and(eq(notifications.type, "DEADLINE_APPROACHING"), eq(notifications.entityId, editionId)) });
    expect(note?.title).toBe("Final editorial review — 11 Oct, 18:00");
    expect(await countEmails("deadline_alert", editionId)).toBeGreaterThan(0);
    const again = await runAutomationTick({ now: later, triggeredBy: "SCHEDULER" });
    expect(again.ran).toEqual([]);
  });

  it("describes the automations with their next occurrence", async () => {
    const described = await describeAutomations(new Date("2026-10-20T10:00:00Z"));
    expect(described.items).toHaveLength(9);
    const request = described.items.find((i) => i.key === "contributionRequest");
    expect(request?.enabled).toBe(true);
    expect(request?.when).toBe("Day 1, 09:00");
    expect(request?.nextAt?.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(request?.editionLabel).toBe("November 2026");
    expect(described.items.find((i) => i.key === "reminder1")?.when).toBe("Day 4, 09:00");
    expect(described.items.find((i) => i.key === "aiProcessing")?.nextAt?.toISOString()).toBe("2026-11-08T22:59:00.000Z");
  });
});
