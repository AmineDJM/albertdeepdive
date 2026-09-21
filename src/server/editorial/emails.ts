/**
 * Email content for the editorial module (information requests). Layouts are rendered by
 * src/server/email/template.ts; this file only assembles the copy.
 */
import type { EmailLayoutInput } from "@/server/email";

export type InformationRequestEmailInput = {
  contributorFirstName: string;
  storyTitle: string;
  /** The newsletter this story is for — required, so no caller can fall back to a hardcoded name. */
  publicationName: string;
  editionLabel: string;
  requesterName: string | null;
  message: string;
  items: { key: string; label: string }[];
  url: string;
  expiresAt: Date;
};

export function informationRequestEmail(input: InformationRequestEmailInput): { subject: string; layout: EmailLayoutInput } {
  const deadline = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" }).format(input.expiresAt);
  const count = input.items.length;
  return {
    subject: `A few details for “${input.storyTitle}” — ${input.publicationName} ${input.editionLabel}`,
    layout: {
      preheader: `${count} quick question${count === 1 ? "" : "s"} about your contribution to ${input.publicationName}.`,
      kicker: `Information request · ${input.editionLabel}`,
      title: `Hi ${input.contributorFirstName}, we need a few details about “${input.storyTitle}”`,
      blocks: [
        { type: "paragraph", text: input.message },
        ...(count ? ([{ type: "callout", title: `What we need (${count})`, text: "Answer what you can — every detail helps us write an accurate story." }, { type: "list", items: input.items.map((i) => i.label) }] as EmailLayoutInput["blocks"]) : []),
        { type: "paragraph", text: `Please answer by ${deadline}. The link works on your phone and takes two minutes; you can also attach photos.` },
        ...(input.requesterName ? ([{ type: "paragraph", text: `Thank you — ${input.requesterName}, ${input.publicationName} newsroom` }] as EmailLayoutInput["blocks"]) : []),
      ],
      cta: { label: "Answer the questions", url: input.url },
      footer: `${input.publicationName}. This link is personal: please do not forward it.`,
    },
  };
}

export function informationRequestAnsweredEmail(input: { requesterName: string; contributorName: string; storyTitle: string; url: string }): { subject: string; layout: EmailLayoutInput } {
  return {
    subject: `${input.contributorName} answered your information request (${input.storyTitle})`,
    layout: {
      kicker: "Information request answered",
      title: `${input.contributorName} sent the details for “${input.storyTitle}”`,
      blocks: [{ type: "paragraph", text: `Hi ${input.requesterName}, the answers were added to the story as a new submission and the missing-information checklist was updated.` }],
      cta: { label: "Open the story", url: input.url },
    },
  };
}
