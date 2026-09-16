/** Job handlers of the campaign engine (registered by src/server/jobs/handlers/index.ts). */
import { JOB_TYPES, registerJobHandler } from "@/server/jobs/registry";
import { runAutomationTick } from "./scheduler";
import { closeCampaign, openCampaign, sendReminders } from "./service";
import type { ReminderKind } from "./emails";

registerJobHandler<{ campaignId: string }, Record<string, unknown>>(JOB_TYPES.CAMPAIGN_SEND_INVITATIONS, async ({ campaignId }, ctx) => {
  ctx.log("opening campaign", { campaignId });
  const result = await openCampaign(campaignId, { triggeredBy: "SCHEDULER", userId: ctx.job.createdById });
  return { ...result, links: undefined };
});

registerJobHandler<{ campaignId: string; kind: ReminderKind }, Record<string, unknown>>(JOB_TYPES.CAMPAIGN_SEND_REMINDERS, async ({ campaignId, kind }, ctx) => {
  ctx.log("sending reminders", { campaignId, kind });
  return sendReminders(campaignId, kind, { triggeredBy: "SCHEDULER", userId: ctx.job.createdById });
});

registerJobHandler<{ campaignId: string }, Record<string, unknown>>(JOB_TYPES.CAMPAIGN_CLOSE, async ({ campaignId }, ctx) => {
  ctx.log("closing campaign", { campaignId });
  return closeCampaign(campaignId, { triggeredBy: "SCHEDULER", userId: ctx.job.createdById });
});

registerJobHandler<Record<string, never>, Record<string, unknown>>(JOB_TYPES.AUTOMATION_TICK, async (_payload, ctx) => {
  ctx.log("automation tick");
  return runAutomationTick({ triggeredBy: "SCHEDULER" });
});
