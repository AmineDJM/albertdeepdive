"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import {
  addContributorsToCampaign,
  availableContributorsForCampaign,
  setCampaignAudience,
  type AudienceInput,
  closeCampaign,
  createOrUpdateCampaign,
  extendCampaign,
  getCampaignForEdition,
  openCampaign,
  reopenCampaign,
  resendInvitation,
  scheduleCampaign,
  scheduleFromDefaults,
  sendReminders,
  unscheduleCampaign,
} from "@/server/campaigns/service";
import { previewInvitation, type InvitationPreview } from "@/server/campaigns/preview";
import type { ReminderKind } from "@/server/campaigns/emails";
import { NotFoundError, ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import type { SelectionMode } from "@/lib/campaigns/selection";
import type { EditionBrief } from "@/lib/campaigns/brief";
import { getUi } from "@/server/i18n/locale";
import { formatZonedLong } from "@/lib/campaigns/schedule";

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
  /*
   * How contributors are chosen, and what they are being asked for.
   *
   * These were on the form and not in this type, so every save sent the server nothing for them
   * and the server's defaults won: a campaign saved after any edit lost its brief and reverted to
   * drawing at random. The screens that own these fields send them back unchanged; the ones that
   * change them are the only ones that change them.
   */
  selectionMode: SelectionMode;
  drawCount: number;
  selectedContributorIds: string[];
  brief: EditionBrief;
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
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    await createOrUpdateCampaign(editionId, input, user);
    revalidateCampaign(editionId);
    return ok(null, tr("Campaign saved"));
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * Who is asked and by when, from the one screen that asks it.
 *
 * Standard's campaign screen decides three things — which people, how many, and the closing date —
 * and writes only those. The five-date schedule, the campus targets and the brief are left exactly
 * as they were, by a writer that never touches them.
 */
export async function saveAudienceAction(editionId: string, input: AudienceInput): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    await setCampaignAudience(editionId, input, user);
    revalidateCampaign(editionId);
    return ok(null, tr("Saved"));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Rebuilds the schedule from the monthly system defaults (and keeps pools and targets). */
export async function applyCampaignDefaultsAction(editionId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    await scheduleFromDefaults(editionId, user);
    revalidateCampaign(editionId);
    return ok(null, tr("Schedule rebuilt from the monthly defaults"));
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

    /*
     * A campaign that invites nobody says so, and says why.
     *
     * The usual cause is a rule doing its job: everyone in the chosen groups wrote for the last
     * issue and re-inviting them is off, so there is nobody new to ask. That is a decision the
     * editor made weeks ago and will not remember, and "0 contributors invited" beside a tick looks
     * exactly like a campaign that went out fine — which is how an issue reaches its deadline with
     * no contributions and nobody knowing why.
     */
    if (result.invited === 0) {
      const because = result.excludedAsPrevious
        ? `every one of the ${result.excludedAsPrevious} eligible contributors wrote for the previous issue, and re-inviting them is switched off`
        : "no contributor in the selected groups is eligible";
      return ok(
        { invited: 0, emailsSent: 0 },
        `Campaign opened, but nobody was invited: ${because}. Turn on “Invite previous contributors”, choose other groups, or add contributors by hand.`,
      );
    }

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
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    const campaign = await requireCampaign(editionId);
    await reopenCampaign(campaign.id, { graceEndsAt: graceEndsAt ? new Date(graceEndsAt) : undefined, userId: user.id });
    revalidateCampaign(editionId);
    return ok(null, tr("Campaign reopened — contributors can submit again"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function extendCampaignAction(editionId: string, graceEndsAt: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    const campaign = await requireCampaign(editionId);
    await extendCampaign(campaign.id, { graceEndsAt: new Date(graceEndsAt), userId: user.id });
    revalidateCampaign(editionId);
    return ok(null, tr("Deadline extended and personal links renewed"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function resendInvitationAction(editionId: string, requestId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    const result = await resendInvitation(requestId, user);
    revalidateCampaign(editionId);
    return result.ok ? ok(null, tr("Invitation sent again with a fresh link")) : ok(null, tr("The email could not be sent — check the email log"));
  } catch (err) {
    return toActionFailure(err);
  }
}


export type CandidateContributor = { id: string; firstName: string; lastName: string; email: string; type: string; campusId: string | null; campusName: string | null };

/** Pool contributors not yet invited to this edition, for the manual "add contributors" picker. */
export async function searchCandidatesAction(editionId: string, filters: { q?: string; campusId?: string } = {}): Promise<ActionResult<CandidateContributor[]>> {
  try {
    await requirePermission("campaign:manage");
    const campaign = await requireCampaign(editionId);
    const rows = await availableContributorsForCampaign(campaign.id, { q: filters.q, campusId: filters.campusId });
    return ok(rows);
  } catch (err) {
    return toActionFailure(err);
  }
}

/**
 * Adds chosen pool contributors to this edition's campaign by hand, on top of the random
 * selection. If the campaign is already open they are emailed their personal link straight away.
 */
export async function addContributorsToEditionAction(editionId: string, contributorIds: string[]): Promise<ActionResult<{ added: number; sent: number }>> {
  try {
    const user = await requirePermission("campaign:manage");
    const campaign = await requireCampaign(editionId);
    const result = await addContributorsToCampaign(campaign.id, contributorIds, user);
    revalidateCampaign(editionId);
    const message = result.added === 0 ? "Those contributors were already invited" : result.sent > 0 ? `${result.added} added · ${result.sent} invited by email` : `${result.added} added to the edition`;
    return ok(result, message);
  } catch (err) {
    return toActionFailure(err);
  }
}


/**
 * What the invitation says, before anybody gets it.
 *
 * Read-only, and read on demand: the email is built from the brief, the note, the deadline and the
 * people currently selected, all of which change on the screens either side of this one, so a copy
 * rendered with the page would be out of date by the time somebody opened the dialog.
 */
export async function invitationPreviewAction(editionId: string): Promise<ActionResult<InvitationPreview>> {
  try {
    await requirePermission("campaign:manage");
    return ok(await previewInvitation(editionId));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Sets the invitation to go out on its own at `when` (ISO), or moves a date already chosen. */
export async function scheduleInvitationsAction(editionId: string, when: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    const campaign = await scheduleCampaign(editionId, new Date(when), user);
    revalidateCampaign(editionId);
    return ok(null, tr("The invitation will go out on {date}", { date: formatZonedLong(campaign.opensAt) }));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Takes it back out of the diary — nothing leaves until somebody presses send. */
export async function unscheduleInvitationsAction(editionId: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("campaign:manage");
    await unscheduleCampaign(editionId, user);
    revalidateCampaign(editionId);
    return ok(null, tr("Nothing will go out until you send it"));
  } catch (err) {
    return toActionFailure(err);
  }
}
