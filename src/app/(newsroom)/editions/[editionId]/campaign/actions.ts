"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import {
  closeCampaign,
  createOrUpdateCampaign,
  extendCampaign,
  getCampaignForEdition,
  openCampaign,
  reopenCampaign,
  resendInvitation,
  scheduleFromDefaults,
  sendReminders,
} from "@/server/campaigns/service";
import type { ReminderKind } from "@/server/campaigns/emails";
import { NotFoundError, ok, toActionFailure, type ActionResult } from "@/lib/action-result";

/** The campaign form speaks ISO strings; the service coerces them and validates the ordering. */
export type CampaignFormInput = {
  name: string;
  opensAt: string;
  reminder1At: string;
  reminder2At: string;
  deadlineAt: string;
  graceEndsAt: string;
  targets: Record<string, number>;
  contributorGroupIds: string[];
  introMessage: string | null;
  autoProcess: boolean;
  reinvitePrevious: boolean;
};

function revalidateCampaign(editionId: string) {
  revalidatePath(`/editions/${editionId}/campaign`);
  revalidatePath(`/editions/${editionId}`);
  revalidatePath(`/editions/${editionId}/inbox`);
  revalidatePath(`/editions/${editionId}/settings`);
  revalidatePath("/automations");
}

async function requireCampaign(editionId: string) {
  const campaign = await getCampaignForEdition(editionId);
  if (!campaign) throw new NotFoundError("Campaign");
  return campaign;
}

export async function saveCampaignAction(editionId: string, input: CampaignFormInput): Promise<ActionResult> {
  try {
    const user = await requirePermission("campaign:manage");
    await createOrUpdateCampaign(editionId, input, user);
    revalidateCampaign(editionId);
    return ok(null, "Campaign saved");
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Rebuilds the schedule from the monthly system defaults (and keeps pools and targets). */
export async function applyCampaignDefaultsAction(editionId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("campaign:manage");
    await scheduleFromDefaults(editionId, user);
    revalidateCampaign(editionId);
    return ok(null, "Schedule rebuilt from the monthly defaults");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function launchCampaignAction(editionId: string): Promise<ActionResult<{ invited: number; emailsSent: number }>> {
  try {
    const user = await requirePermission("campaign:manage");
    const campaign = await requireCampaign(editionId);
    const result = await openCampaign(campaign.id, { triggeredBy: "MANUAL", userId: user.id });
    revalidateCampaign(editionId);
    if (result.skipped) return ok({ invited: 0, emailsSent: 0 }, result.reason ?? "Nothing to do");
    const shortfall = Object.values(result.shortfall).reduce((n, v) => n + v, 0);
    return ok(
      { invited: result.invited, emailsSent: result.emailsSent },
      `${result.invited} contributor${result.invited === 1 ? "" : "s"} invited · ${result.emailsSent} email${result.emailsSent === 1 ? "" : "s"} sent${result.emailsFailed ? ` · ${result.emailsFailed} failed` : ""}${shortfall ? ` · ${shortfall} short of target` : ""}`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function sendReminderAction(editionId: string, kind: ReminderKind): Promise<ActionResult<{ emailsSent: number }>> {
  try {
    const user = await requirePermission("campaign:manage");
    const campaign = await requireCampaign(editionId);
    const result = await sendReminders(campaign.id, kind, { triggeredBy: "MANUAL", userId: user.id });
    revalidateCampaign(editionId);
    if (result.skipped) return ok({ emailsSent: 0 }, result.reason ?? "Reminder already sent");
    return ok(
      { emailsSent: result.emailsSent },
      `${result.emailsSent} reminder${result.emailsSent === 1 ? "" : "s"} sent to ${result.targeted} contributor${result.targeted === 1 ? "" : "s"}${result.emailsFailed ? ` · ${result.emailsFailed} failed` : ""}`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function closeCampaignAction(editionId: string): Promise<ActionResult<{ submissions: number }>> {
  try {
    const user = await requirePermission("campaign:manage");
    const campaign = await requireCampaign(editionId);
    const result = await closeCampaign(campaign.id, { triggeredBy: "MANUAL", userId: user.id });
    revalidateCampaign(editionId);
    if (result.skipped) return ok({ submissions: 0 }, result.reason ?? "The campaign is already closed");
    return ok(
      { submissions: result.submissions },
      `Campaign closed · ${result.submissions} submission${result.submissions === 1 ? "" : "s"} from ${result.contributors} contributor${result.contributors === 1 ? "" : "s"}${result.processingQueued ? " · AI processing queued" : ""}`,
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function reopenCampaignAction(editionId: string, graceEndsAt?: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("campaign:manage");
    const campaign = await requireCampaign(editionId);
    await reopenCampaign(campaign.id, { graceEndsAt: graceEndsAt ? new Date(graceEndsAt) : undefined, userId: user.id });
    revalidateCampaign(editionId);
    return ok(null, "Campaign reopened — contributors can submit again");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function extendCampaignAction(editionId: string, graceEndsAt: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("campaign:manage");
    const campaign = await requireCampaign(editionId);
    await extendCampaign(campaign.id, { graceEndsAt: new Date(graceEndsAt), userId: user.id });
    revalidateCampaign(editionId);
    return ok(null, "Deadline extended and personal links renewed");
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function resendInvitationAction(editionId: string, requestId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("campaign:manage");
    const result = await resendInvitation(requestId, user);
    revalidateCampaign(editionId);
    return result.ok ? ok(null, "Invitation sent again with a fresh link") : ok(null, "The email could not be sent — check the email log");
  } catch (err) {
    return toActionFailure(err);
  }
}
