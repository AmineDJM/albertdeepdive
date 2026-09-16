import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contributors, editions, emailLog, submissionCampuses, submissions } from "@/server/db/schema";
import { createLogger } from "@/server/logger";
import { audit } from "@/server/audit";
import { notifyEditors } from "@/server/campaigns/notify";
import { fetchNewGmailMessages, getGmailConnection, type IncomingMessage } from "./gmail";
import { CONSENT_TEXT_VERSION } from "@/lib/constants";
import { wordCount } from "@/lib/utils";

const log = createLogger("email:inbound");

/** Statuses in which an edition is still taking contributions. */
const COLLECTING = ["OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD"] as const;

/**
 * Strips the quoted history Gmail appends to a reply, so what reaches the newsroom is what the
 * person actually wrote rather than the whole thread again.
 */
export function replyBody(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex((line) =>
    /^\s*(On .+ wrote:|Le .+ a écrit\s*:|-{2,}\s*(Forwarded message|Original Message|Message d'origine)\s*-*|_{5,})\s*$/i.test(line) ||
    /^\s*>{1,}/.test(line),
  );
  const body = (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
  return body.replace(/\n{3,}/g, "\n\n");
}

/** The subject without the reply and forward prefixes people's mail clients keep adding. */
export function cleanSubject(subject: string): string {
  return subject.replace(/^(\s*(re|fwd?|tr|rép)\s*:\s*)+/i, "").trim() || "Reply to the newsroom";
}

export type InboundOutcome =
  | { kind: "SUBMISSION"; submissionId: string; contributorId: string; editionId: string }
  | { kind: "IGNORED"; reason: string };

/**
 * Turns one reply into newsroom material.
 *
 * A message from a known contributor, while an edition is collecting, becomes a submission in the
 * triage inbox — the same place the form's contributions land, marked as having come by email so
 * an editor knows the difference. Anything else is left alone: the newsroom never invents a
 * contributor, and never files something it cannot attribute.
 */
export async function handleIncomingMessage(message: IncomingMessage): Promise<InboundOutcome> {
  const body = replyBody(message.text);
  if (!body) return { kind: "IGNORED", reason: "The message had no text of its own." };

  const contributor = await db.query.contributors.findFirst({ where: eq(contributors.email, message.from) });
  if (!contributor) return { kind: "IGNORED", reason: `${message.from} is not a contributor.` };

  const edition = await db.query.editions.findFirst({
    where: inArray(editions.status, [...COLLECTING]),
    orderBy: [desc(editions.createdAt)],
  });
  if (!edition) return { kind: "IGNORED", reason: "No edition is collecting contributions." };

  // The same message must never be filed twice, however often the mailbox is polled.
  if (message.messageId) {
    const seen = await db.query.submissions.findFirst({
      where: and(eq(submissions.editionId, edition.id), eq(submissions.source, "email")),
      columns: { id: true, extra: true },
    });
    if (seen && (seen.extra as { messageId?: string } | null)?.messageId === message.messageId) {
      return { kind: "IGNORED", reason: "Already filed." };
    }
  }

  const title = cleanSubject(message.subject);
  const [submission] = await db
    .insert(submissions)
    .values({
      editionId: edition.id,
      contributorId: contributor.id,
      storyType: "OTHER",
      title,
      campusScope: contributor.campusId ? "SINGLE" : "SCHOOL_WIDE",
      description: body,
      contactName: `${contributor.firstName} ${contributor.lastName}`.trim(),
      contactEmail: contributor.email,
      extra: { messageId: message.messageId, receivedAt: message.receivedAt.toISOString(), attachments: message.attachments.length },
      language: contributor.preferredLanguage ?? "en",
      status: "NEEDS_REVIEW",
      source: "email",
      // Consent cannot be assumed from a reply: an editor confirms it before the story is used.
      publicationConsent: false,
      imageRightsConfirmed: false,
      consentTextVersion: CONSENT_TEXT_VERSION,
      wordCount: wordCount(body),
      submittedAt: message.receivedAt,
    })
    .returning();

  if (contributor.campusId) {
    await db.insert(submissionCampuses).values({ submissionId: submission.id, campusId: contributor.campusId }).onConflictDoNothing();
  }

  await db.insert(emailLog).values({
    to: contributor.email,
    subject: `↩ ${title}`,
    html: message.html ?? `<pre>${body}</pre>`,
    textBody: body,
    template: "inbound_reply",
    status: "LOGGED",
    provider: "gmail",
    entityType: "SUBMISSION",
    entityId: submission.id,
    editionId: edition.id,
    contributorId: contributor.id,
    sentAt: message.receivedAt,
  });

  await audit({
    action: "email.inbound.filed",
    actorType: "SYSTEM",
    entityType: "SUBMISSION",
    entityId: submission.id,
    editionId: edition.id,
    metadata: { from: message.from, messageId: message.messageId, attachments: message.attachments.length },
  });

  log.info("reply filed", { submissionId: submission.id, from: message.from, edition: edition.label });
  return { kind: "SUBMISSION", submissionId: submission.id, contributorId: contributor.id, editionId: edition.id };
}

export type InboundRunResult = { polled: number; filed: number; ignored: { reason: string; from: string }[] };

/** Polls the connected mailbox and files whatever it finds. Safe to run on a schedule. */
export async function pollInbox(): Promise<InboundRunResult> {
  const connection = await getGmailConnection();
  if (!connection || !connection.receiveEnabled) return { polled: 0, filed: 0, ignored: [] };

  const messages = await fetchNewGmailMessages();
  const ignored: { reason: string; from: string }[] = [];
  let filed = 0;
  const editionIds = new Set<string>();

  for (const message of messages) {
    try {
      const outcome = await handleIncomingMessage(message);
      if (outcome.kind === "SUBMISSION") {
        filed += 1;
        editionIds.add(outcome.editionId);
      } else {
        ignored.push({ reason: outcome.reason, from: message.from });
      }
    } catch (err) {
      log.error("could not file a reply", { from: message.from, err });
      ignored.push({ reason: err instanceof Error ? err.message : String(err), from: message.from });
    }
  }

  for (const editionId of editionIds) {
    const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId), columns: { id: true, label: true } });
    await notifyEditors({
      type: "CONTRIBUTION_REQUEST",
      title: `${filed} contribution${filed === 1 ? "" : "s"} arrived by email`,
      body: `${edition?.label ?? "The current edition"} received ${filed} repl${filed === 1 ? "y" : "ies"} in the newsroom mailbox.`,
      entityType: "EDITION",
      entityId: editionId,
      href: `/editions/${editionId}/inbox`,
    });
  }

  if (messages.length) log.info("inbox polled", { polled: messages.length, filed, ignored: ignored.length });
  return { polled: messages.length, filed, ignored };
}
