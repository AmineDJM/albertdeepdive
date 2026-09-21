/**
 * Campaign email templates — every message the campaign engine sends, built on the shared
 * transactional layout.
 *
 * Every one of these used to sign itself "Albert's Deep Dive", because that is who Briefly was
 * built for and nobody went back afterwards. A customer creating their own newsletter watched it
 * introduce itself to their contributors under somebody else's name. The name now arrives in the
 * edition context and is required, so a call site that forgets it does not compile.
 */
import type { EmailLayoutInput } from "@/server/email";
import { calendarDaysUntil, formatZoned, formatZonedLong } from "@/lib/campaigns/schedule";
import type { Ask } from "@/lib/campaigns/brief";

export const CAMPAIGN_TEMPLATES = {
  invitation: "campaign_invitation",
  reminder1: "campaign_reminder_1",
  reminder2: "campaign_reminder_2",
  grace: "campaign_grace",
  closed: "campaign_closed",
  editorialAlert: "editorial_alert",
  lowCoverage: "low_coverage_alert",
  deadlineAlert: "deadline_alert",
} as const;

export type EmailMessage = { subject: string; layout: EmailLayoutInput; template: string };

export type ContributorContext = { firstName: string; lastName: string; campusName?: string | null };
export type EditionContext = {
  /** What this newsletter is called. Required: the compiler is the only reliable way to find every
   *  place that used to write a name out by hand. */
  publicationName: string;
  label: string;
  issueNumber: number;
  publicationTargetAt?: Date | null;
};
export type CampaignContext = { introMessage?: string | null; deadlineAt: Date; graceEndsAt: Date; asks?: readonly Ask[]; openContributions?: boolean };

/**
 * What to send, when the editor has asked for nothing in particular.
 *
 * This was a list of one school's own categories — Business Deep Dives, campus rivalries, admissions
 * — sent to every customer of the platform whatever they publish. A law firm's newsletter does not
 * have campus rivalries. What is left is the shape of any contribution worth having: something that
 * happened, who was involved, and a picture of it.
 */
const WHAT_TO_SEND = [
  "Something that happened: a result, a decision, a launch, a visit — with the date",
  "Events, past or coming up, with where and when",
  "Projects and the people behind them",
  "Numbers worth knowing, and where they come from",
  "Photographs (with a caption and who took them)",
];

function kicker(edition: EditionContext) {
  return `${edition.publicationName} · ${edition.label}`;
}

function footer(publicationName: string, contactEmail: string | null) {
  const why = `You receive this email because you are part of the ${publicationName} contributor network.`;
  return contactEmail ? `${why} Questions? Write to ${contactEmail}.` : why;
}

function deadlineRows(campaign: CampaignContext) {
  return [
    { label: "Deadline", value: `${formatZonedLong(campaign.deadlineAt)} (Paris time)` },
    { label: "Late entries", value: `accepted until ${formatZoned(campaign.graceEndsAt)}` },
  ];
}

/**
 * What this edition is asking for, in the email rather than only behind the link.
 *
 * A contributor who has to click through to find out what is wanted is deciding whether to bother
 * without the information that would persuade them. When the editor has asked for something in
 * particular, the ask travels with the invitation; when they have not, the old general list is the
 * honest thing to send, because "anything" is genuinely what is wanted.
 */
function whatWeAskedBlocks(campaign: CampaignContext): EmailMessage["layout"]["blocks"] {
  const asks = campaign.asks ?? [];
  if (!asks.length) {
    return [
      { type: "callout", title: "What to send", text: "Pick a story type, answer a few questions, add photos. No account needed — this link is yours." },
      { type: "list", items: WHAT_TO_SEND },
    ];
  }
  const topics = asks.filter((ask) => ask.kind === "TOPIC");
  const questions = asks.filter((ask) => ask.kind === "QUESTION");
  const blocks: EmailMessage["layout"]["blocks"] = [];
  if (topics.length) blocks.push({ type: "callout", title: topics.length === 1 ? "Your topic" : "Your topics", text: topics.map((ask) => ask.text).join(" · ") });
  if (questions.length) blocks.push({ type: "list", items: questions.map((ask) => (ask.hint ? `${ask.text} — ${ask.hint}` : ask.text)) });
  if (campaign.openContributions !== false) {
    blocks.push({ type: "paragraph", text: "And anything else worth telling — the best thing in most issues is the thing nobody thought to ask about." });
  }
  return blocks;
}

export function invitationEmail(input: { contributor: ContributorContext; edition: EditionContext; campaign: CampaignContext; link: string; contactEmail: string | null }): EmailMessage {
  const { contributor, edition, campaign } = input;
  const intro = campaign.introMessage?.trim() || "A new issue is in the making and the newsroom needs your eyes and ears.";
  return {
    template: CAMPAIGN_TEMPLATES.invitation,
    subject: `${edition.publicationName} — ${edition.label}: tell us what happened around you`,
    layout: {
      preheader: `Your personal link to contribute to the ${edition.label} issue. It takes about five minutes.`,
      kicker: kicker(edition),
      title: "Tell us what happened around you",
      blocks: [
        { type: "paragraph", text: `Hi ${contributor.firstName},` },
        { type: "paragraph", text: intro },
        { type: "paragraph", text: `Anything from ${contributor.campusName ? `the ${contributor.campusName} campus` : "your corner of the school"} is welcome: the more precise the names, dates and numbers, the better the article.` },
        { type: "kv", rows: deadlineRows(campaign) },
        ...whatWeAskedBlocks(campaign),
      ],
      cta: { label: "Contribute in 5 minutes", url: input.link },
      footer: footer(edition.publicationName, input.contactEmail),
    },
  };
}

export type ReminderKind = "REMINDER_1" | "REMINDER_2" | "GRACE_PERIOD";

export function reminderEmail(kind: ReminderKind, input: { contributor: ContributorContext; edition: EditionContext; campaign: CampaignContext; link: string; contactEmail: string | null; now?: Date }): EmailMessage {
  const { contributor, edition, campaign } = input;
  const now = input.now ?? new Date();
  const base = { kicker: kicker(edition), footer: footer(edition.publicationName, input.contactEmail), cta: { label: "Send my story", url: input.link } };
  if (kind === "REMINDER_1") {
    const daysLeft = Math.max(0, calendarDaysUntil(campaign.deadlineAt, now));
    const left = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
    return {
      template: CAMPAIGN_TEMPLATES.reminder1,
      subject: daysLeft <= 1 ? `Reminder: last chance to contribute to ${edition.publicationName}` : `Reminder: ${daysLeft} days left to contribute to ${edition.publicationName}`,
      layout: {
        ...base,
        preheader: `The ${edition.label} issue closes ${left}. Your link still works.`,
        title: daysLeft <= 1 ? "Still time to send your story" : `${daysLeft} days left to send your story`,
        blocks: [
          { type: "paragraph", text: `Hi ${contributor.firstName},` },
          { type: "paragraph", text: `Contributions for the ${edition.label} issue close ${left}. A few lines are enough — the newsroom does the writing, you bring the facts.` },
          { type: "kv", rows: deadlineRows(campaign) },
          { type: "paragraph", text: "Already sent something? Thank you — you can use the same link to add another story or a few photos." },
        ],
      },
    };
  }
  if (kind === "REMINDER_2") {
    return {
      template: CAMPAIGN_TEMPLATES.reminder2,
      subject: `Last day to contribute to ${edition.publicationName}`,
      layout: {
        ...base,
        preheader: `Today is the last day for the ${edition.label} issue.`,
        title: "Last day to send your story",
        blocks: [
          { type: "paragraph", text: `Hi ${contributor.firstName},` },
          { type: "paragraph", text: `Today is the last day to contribute to the ${edition.label} issue. Even a short note with names and a photo can become an article.` },
          { type: "kv", rows: [{ label: "Deadline", value: `tonight, ${formatZoned(campaign.deadlineAt, { day: undefined, month: undefined })} (Paris time)` }, { label: "Late entries", value: `accepted until ${formatZoned(campaign.graceEndsAt)}` }] },
        ],
      },
    };
  }
  return {
    template: CAMPAIGN_TEMPLATES.grace,
    subject: `${edition.publicationName} closes tonight — last call`,
    layout: {
      ...base,
      preheader: `Late entries for the ${edition.label} issue are accepted until tonight.`,
      title: "The newsroom closes tonight",
      blocks: [
        { type: "paragraph", text: `Hi ${contributor.firstName},` },
        { type: "paragraph", text: `The deadline for the ${edition.label} issue has passed, but late entries are still accepted until ${formatZoned(campaign.graceEndsAt)} (Paris time). After that the editors start working on the issue.` },
        { type: "callout", text: "If you have a story half-written, send it as it is — the newsroom can come back to you for details." },
      ],
    },
  };
}

export function closedEmail(input: { contributor: ContributorContext; edition: EditionContext; submissionsCount: number; contactEmail: string | null }): EmailMessage {
  const { contributor, edition } = input;
  const count = input.submissionsCount;
  const publication = edition.publicationTargetAt ? `The issue is planned for ${formatZoned(edition.publicationTargetAt, { hour: undefined, minute: undefined })}.` : "The issue will be out in a few weeks.";
  return {
    template: CAMPAIGN_TEMPLATES.closed,
    subject: `Thank you for contributing to ${edition.publicationName} — ${edition.label}`,
    layout: {
      kicker: kicker(edition),
      preheader: `Your ${count === 1 ? "story is" : `${count} stories are`} in the newsroom.`,
      title: `Thank you, ${contributor.firstName}`,
      blocks: [
        { type: "paragraph", text: `Contributions for the ${edition.label} issue are now closed. Your ${count === 1 ? "story is" : `${count} stories are`} in the newsroom.` },
        { type: "paragraph", text: "The editors are now reading everything, grouping related submissions and writing the articles. If something is missing, they may email you with a short question." },
        { type: "paragraph", text: publication },
      ],
      footer: footer(edition.publicationName, input.contactEmail),
    },
  };
}

export function editorialAlertEmail(input: { edition: EditionContext; counts: { submissions: number; clusters: number; stories: number; warnings: number }; link: string }): EmailMessage {
  const { edition, counts } = input;
  return {
    template: CAMPAIGN_TEMPLATES.editorialAlert,
    subject: `AI processing finished — ${edition.label}: ${counts.stories} story candidates`,
    layout: {
      kicker: kicker(edition),
      title: "Processing finished — the newsroom is ready",
      blocks: [
        { type: "paragraph", text: `The submissions of the ${edition.label} issue have been normalised, classified and grouped. Editorial review can start.` },
        {
          type: "kv",
          rows: [
            { label: "Submissions", value: String(counts.submissions) },
            { label: "Story clusters", value: String(counts.clusters) },
            { label: "Story candidates", value: String(counts.stories) },
            { label: "Warnings", value: String(counts.warnings) },
          ],
        },
        ...(counts.warnings ? [{ type: "callout" as const, title: "Attention", text: `${counts.warnings} ${counts.warnings === 1 ? "item needs" : "items need"} a human decision: conflicting facts, duplicates or missing information.` }] : []),
      ],
      cta: { label: "Open the edition", url: input.link },
    },
  };
}

export function lowCoverageEmail(input: { edition: EditionContext; campuses: { name: string; submissions: number }[]; average: number; link: string }): EmailMessage {
  const { edition } = input;
  const names = input.campuses.map((c) => c.name).join(", ");
  return {
    template: CAMPAIGN_TEMPLATES.lowCoverage,
    subject: `Low campus coverage — ${edition.label}: ${names}`,
    layout: {
      kicker: kicker(edition),
      title: `${names} ${input.campuses.length === 1 ? "is" : "are"} under-represented`,
      blocks: [
        { type: "paragraph", text: `Submissions for the ${edition.label} issue are unevenly spread across campuses (average ${input.average.toFixed(1)} per campus).` },
        { type: "kv", rows: input.campuses.map((c) => ({ label: c.name, value: `${c.submissions} ${c.submissions === 1 ? "submission" : "submissions"}` })) },
        { type: "paragraph", text: "Consider asking the campus ambassadors for a contribution or extending the campaign for that campus." },
      ],
      cta: { label: "See the coverage", url: input.link },
    },
  };
}

export function deadlineAlertEmail(input: { edition: EditionContext; finalReviewAt: Date; approved: number; total: number; link: string }): EmailMessage {
  const { edition } = input;
  return {
    template: CAMPAIGN_TEMPLATES.deadlineAlert,
    subject: `Final review tomorrow — ${edition.label}: ${input.approved} of ${input.total} articles approved`,
    layout: {
      kicker: kicker(edition),
      title: `Final editorial review — ${formatZoned(input.finalReviewAt)}`,
      blocks: [
        { type: "paragraph", text: `The final review of the ${edition.label} issue is in less than 24 hours.` },
        { type: "kv", rows: [{ label: "Articles approved", value: `${input.approved} of ${input.total}` }, { label: "Final review", value: `${formatZonedLong(input.finalReviewAt)} (Paris time)` }] },
        ...(input.approved < input.total ? [{ type: "callout" as const, text: `${input.total - input.approved} ${input.total - input.approved === 1 ? "article still needs" : "articles still need"} approval before layout can be locked.` }] : []),
      ],
      cta: { label: "Review the articles", url: input.link },
    },
  };
}
