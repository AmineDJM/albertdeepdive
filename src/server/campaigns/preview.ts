import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NotFoundError } from "@/lib/action-result";
import { renderEmailLayout } from "@/server/email/template";
import { invitationEmail } from "./emails";
import { contributorContext, getCampaignForEdition, resolveSelection } from "./service";
import { getContactSettings } from "@/server/campaigns/settings";
import { normaliseBrief } from "@/lib/campaigns/brief";
import { getUi } from "@/server/i18n/locale";

/**
 * The email, before anybody gets it.
 *
 * Sending the invitations is the one irreversible thing in an edition: four hundred people read
 * it, and a sentence somebody meant to change is a sentence four hundred people read. It went out
 * on one click, with nothing shown first but the count.
 *
 * So this renders exactly what will be sent — the same builder the sender uses, with the same
 * brief, the same intro message and the same deadline — addressed to the first person who would
 * receive it. The link inside is a stand-in: a real one belongs to a real request and is created
 * when the invitations go, and putting a live token in a preview would be a way of submitting on
 * somebody else's behalf.
 */

export type InvitationPreview = {
  status: string;
  /** When it is set to go out on its own, as an ISO instant. Null when nothing is scheduled. */
  scheduledFor: string | null;
  deadlineAt: string;
  subject: string;
  html: string;
  recipients: { total: number; names: string[]; mode: string };
  /** Whether "send now" is a thing that can happen, and what to say when it is not. */
  canSend: boolean;
  why: string | null;
};

const PREVIEW_LINK = "#preview";

export async function previewInvitation(editionId: string): Promise<InvitationPreview> {
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const campaign = await getCampaignForEdition(editionId);
  if (!campaign) throw new NotFoundError("Campaign");

  const selection = await resolveSelection(campaign);
  // `selected` is a list of ids; the names are what a person needs to see before pressing send.
  const people = await contributorContext(selection.selected);
  const names = selection.selected.map((id) => {
    const person = people.get(id);
    return person ? `${person.firstName} ${person.lastName}`.trim() : "";
  }).filter(Boolean);
  const sample = selection.selected.length ? (people.get(selection.selected[0]) ?? null) : null;
  const brief = normaliseBrief(campaign.brief);
  const contact = await getContactSettings();

  const message = invitationEmail({
    // With nobody selected there is still an email to look at, addressed to the person the editor
    // is about to choose. A blank preview would say the least at the moment it matters most.
    contributor: sample ? { firstName: sample.firstName, lastName: sample.lastName, campusName: sample.campusName } : { firstName: "—", lastName: "" },
    edition: { label: edition.label, issueNumber: edition.issueNumber, publicationTargetAt: edition.publicationTargetAt },
    campaign: { introMessage: campaign.introMessage, deadlineAt: campaign.deadlineAt, graceEndsAt: campaign.graceEndsAt, asks: brief.asks, openContributions: brief.openContributions },
    link: PREVIEW_LINK,
    contactEmail: contact.email,
  });

  const closed = campaign.status === "CLOSED";
  const alreadyOut = campaign.status !== "DRAFT" && campaign.status !== "SCHEDULED";
  // Translated here rather than on the screen: the reason is a sentence, and the screen would
  // have to know the three of them to look them up.
  const tr = await getUi();
  return {
    status: campaign.status,
    scheduledFor: campaign.status === "SCHEDULED" ? campaign.opensAt.toISOString() : null,
    deadlineAt: campaign.deadlineAt.toISOString(),
    subject: message.subject,
    html: renderEmailLayout(message.layout),
    recipients: { total: selection.selected.length, names: names.slice(0, 12), mode: selection.mode },
    canSend: !alreadyOut && !closed && selection.selected.length > 0,
    why: closed
      ? tr("This campaign is closed.")
      : alreadyOut
        ? tr("The invitations have already gone out.")
        : selection.selected.length === 0
          ? tr("Nobody is chosen yet, so there is nobody to write to.")
          : null,
  };
}
