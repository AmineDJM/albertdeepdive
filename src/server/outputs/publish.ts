import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { sendEmail } from "@/server/email";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { durableImageUrls } from "@/server/media/durable";
import { newsletterLook } from "@/server/publications/brand";
import { recipientsFor } from "@/server/subscribers/service";
import { showsBrieflyBranding } from "@/server/billing/entitlements";
import { renderEditionEmail } from "./email-edition";
import { designEmailFor } from "@/server/design/email";
import { setOutputStatus } from "./service";
import { NotFoundError, ValidationError } from "@/lib/action-result";

const log = createLogger("outputs");

export type SendResult = { sent: number; failed: number; skipped: number; outputId: string };

async function loadOutput(
  editionId: string,
  format: (typeof s.outputFormatEnum.enumValues)[number],
) {
  const output = await db.query.editionOutputs.findFirst({
    where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, format)),
  });
  if (!output) throw new NotFoundError(`${format} output`);
  return output;
}

/**
 * Send an edition to the people subscribed to its title.
 *
 * Sends one message per reader rather than one message to a list, because each carries its own
 * unsubscribe link — a shared link would let any reader unsubscribe every other reader. Delivery
 * failures are counted, not thrown: one bad address must not stop the send.
 */
export async function sendEditionEmail(
  editionId: string,
  userId?: string | null,
  options: { resend?: boolean } = {},
): Promise<SendResult> {
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  if (!edition.publicationId)
    throw new ValidationError(
      "This edition does not belong to a publication, so it has no subscribers to send to.",
    );

  const output = await loadOutput(editionId, "EMAIL");
  // A second send is possible and deliberate: a corrected issue is worth the inbox, and refusing
  // outright left a newsroom that had just fixed a mistake with nothing to do about it. It never
  // happens by accident — `resend` comes from a control that says how many people will get it
  // twice, and the audit records which send this was.
  if (output.status === "PUBLISHED" && !options.resend) {
    throw new ValidationError(
      "This edition has already been emailed. Use “Send again” if the readers should get the corrected issue.",
    );
  }

  const [organization, publication, recipients, showBrieflyMark] = await Promise.all([
    edition.organizationId
      ? db.query.organizations.findFirst({ where: eq(s.organizations.id, edition.organizationId) })
      : Promise.resolve(undefined),
    db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId) }),
    recipientsFor(edition.publicationId),
    edition.organizationId ? showsBrieflyBranding(edition.organizationId) : Promise.resolve(true),
  ]);

  if (!recipients.length) {
    await setOutputStatus(output.id, "FAILED", {
      lastError: "Nobody has confirmed a subscription to this title yet.",
    });
    throw new ValidationError("Nobody has confirmed a subscription to this title yet.");
  }

  await setOutputStatus(output.id, "GENERATING", {
    recipientCount: recipients.length,
    lastError: null,
  });

  const doc = await buildEditionDocument(editionId, {
    versionLabel: "email",
  });
  // Every picture in the edition, not only the covers and heroes: a design may place any of them,
  // and a picture with no URL is an empty frame in somebody's inbox.
  const mediaIds = [
    ...new Set(
      [
        doc.meta.cover.mediaId,
        ...doc.articles.map((a) => a.heroMediaId),
        ...doc.media.map((m) => m.id),
      ].filter((id): id is string => !!id),
    ),
  ];
  // Briefly's own addresses, not storage signatures: an email is opened whenever the reader gets to
  // it, long after any signature a bucket will issue has run out.
  const imageUrls = await durableImageUrls(mediaIds, "WEB");

  const webOutput = await db.query.editionOutputs.findFirst({
    where: and(
      eq(s.editionOutputs.editionId, editionId),
      eq(s.editionOutputs.format, "WEB"),
      eq(s.editionOutputs.status, "PUBLISHED"),
    ),
  });
  const webUrl = webOutput?.publicSlug
    ? `${env.NEXT_PUBLIC_APP_URL}/r/${webOutput.publicSlug}`
    : null;

  // The newsletter's own look when one was read from its address, its organisation's otherwise.
  const look = edition.organizationId ? await newsletterLook({ organizationId: edition.organizationId, publicationId: edition.publicationId }) : null;
  const config = output.config ?? {};

  /*
   * An edition that has been designed is sent as its design; one that has not is sent exactly as
   * it has always been. The switch is the existence of a design rather than a flag, so nobody's
   * readers receive something different until somebody designs an issue.
   */
  const designEmail = await designEmailFor(editionId, {
    document: doc,
    imageUrls,
    organizationName: organization?.name ?? doc.meta.masthead.title,
    logoUrl: look?.logoUrl ?? null,
    brand: look?.brand ?? null,
    webUrl,
    footerNote: typeof config.fromName === "string" ? config.fromName : null,
    showBrieflyMark,
    locale: publication?.language ?? "en",
  });

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const unsubscribeUrl = `${env.NEXT_PUBLIC_APP_URL}/s/unsubscribe/${recipient.unsubscribeToken}?p=${edition.publicationId}`;
    const rendered = designEmail
      ? designEmail({ unsubscribeUrl, greetingName: recipient.firstName })
      : renderEditionEmail(doc, {
          organizationName: organization?.name ?? doc.meta.masthead.title,
          logoUrl: look?.logoUrl ?? null,
          accentColour: look?.colour ?? null,
          webUrl,
          unsubscribeUrl,
          greetingName: recipient.firstName,
          imageUrls,
          footerNote: typeof config.fromName === "string" ? config.fromName : null,
          // The reader agreed to receive this title, in the language it publishes in.
          locale: publication?.language ?? "en",
          showBrieflyMark,
        });

    const result = await sendEmail({
      to: recipient.email,
      subject: (typeof config.subject === "string" && config.subject) || rendered.subject,
      template: "edition_email",
      organizationId: edition.organizationId,
      editionId,
      entityType: "EDITION",
      entityId: editionId,
      replyTo: typeof config.replyTo === "string" ? config.replyTo : undefined,
      listUnsubscribeUrl: unsubscribeUrl,
      // The digest is already complete HTML; the transactional layout would wrap it in a second one.
      layout: {
        title: rendered.subject,
        blocks: [],
        rawHtml: rendered.html,
        rawText: rendered.text,
      },
    });
    if (result.ok) sent += 1;
    else failed += 1;
  }

  const status = sent > 0 ? "PUBLISHED" : "FAILED";
  await setOutputStatus(output.id, status, {
    publishedAt: sent > 0 ? new Date() : null,
    generatedAt: new Date(),
    recipientCount: recipients.length,
    deliveredCount: sent,
    lastError: failed > 0 ? `${failed} of ${recipients.length} message(s) failed` : null,
  });

  await audit({
    action: "output.email.send",
    organizationId: edition.organizationId,
    userId,
    entityType: "EDITION",
    entityId: editionId,
    editionId,
    metadata: { sent, failed, recipients: recipients.length, resend: options.resend === true },
  });
  log.info("edition emailed", { editionId, sent, failed });
  return { sent, failed, skipped: 0, outputId: output.id };
}

/**
 * Publish the web edition.
 *
 * There is nothing to render ahead of time: the page is built from the edition on request, so a
 * correction to an article shows up without re-publishing. Publishing is the act of making the
 * address answer.
 */
export async function publishWebEdition(editionId: string, userId?: string | null) {
  const output = await loadOutput(editionId, "WEB");
  if (!output.publicSlug) throw new ValidationError("This web edition has no address yet.");
  const row = await setOutputStatus(output.id, "PUBLISHED", {
    publishedAt: new Date(),
    generatedAt: new Date(),
    lastError: null,
  });
  await audit({
    action: "output.web.publish",
    organizationId: output.organizationId,
    userId,
    entityType: "EDITION",
    entityId: editionId,
    editionId,
    metadata: { slug: output.publicSlug },
  });
  return row;
}

export async function unpublishWebEdition(editionId: string, userId?: string | null) {
  const output = await loadOutput(editionId, "WEB");
  const row = await setOutputStatus(output.id, "READY", { publishedAt: null });
  await audit({
    action: "output.web.unpublish",
    organizationId: output.organizationId,
    userId,
    entityType: "EDITION",
    entityId: editionId,
    editionId,
  });
  return row;
}

/**
 * Make the issue go out again, as it stands now.
 *
 * What "republish" means is different for every format, and pretending otherwise would be the
 * dishonest part. The web page is built when it is read, so it is already showing the corrected
 * issue and there is nothing to re-render. The PDF and the print files are frozen artefacts, so
 * they are made again from the issue as it is today, and the version that went out before stays in
 * the history where it belongs. The email is not touched at all: sending again puts a second
 * message in somebody's inbox, which is a decision a person makes, not a side effect of a button
 * called republish.
 */
export type RepublishLine = {
  format: (typeof s.outputFormatEnum.enumValues)[number];
  done: boolean;
  detail: string;
};

export async function republishEdition(
  editionId: string,
  userId?: string | null,
): Promise<RepublishLine[]> {
  const outputs = await db
    .select()
    .from(s.editionOutputs)
    .where(eq(s.editionOutputs.editionId, editionId));
  if (!outputs.length) throw new ValidationError("This edition has no formats switched on yet.");
  const lines: RepublishLine[] = [];

  const frozen = outputs.filter(
    (output) => output.format === "MAGAZINE" || output.format === "PRINT",
  );
  if (frozen.length) {
    const { requestExport } = await import("@/server/publication/versions");
    try {
      const { version } = await requestExport(editionId, {
        kind: "DRAFT",
        userId,
        notes: "Republished",
      });
      for (const output of frozen) {
        await setOutputStatus(output.id, "PENDING", { versionId: version.id, lastError: null });
        lines.push({
          format: output.format,
          done: true,
          detail: `Being made again as ${version.label}. The version that went out before stays in the history.`,
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      for (const output of frozen)
        lines.push({ format: output.format, done: false, detail: error });
    }
  }

  for (const output of outputs.filter((each) => each.format === "WEB")) {
    if (output.status === "PUBLISHED") {
      await setOutputStatus(output.id, "PUBLISHED", { generatedAt: new Date() });
      lines.push({
        format: "WEB",
        done: true,
        detail: "The page is built when it is read, so it is already showing the corrected issue.",
      });
    } else {
      lines.push({
        format: "WEB",
        done: false,
        detail: "Not published yet — publish it and it will carry the corrected issue.",
      });
    }
  }

  for (const output of outputs.filter((each) => each.format === "EMAIL")) {
    lines.push({
      format: "EMAIL",
      done: false,
      detail:
        output.status === "PUBLISHED"
          ? "Already sent. Republishing does not email anybody again — use “Send again” for that, and every reader gets a second message."
          : "Not sent yet. It will be built from the corrected issue when you send it.",
    });
  }

  await audit({
    action: "output.republish",
    organizationId: outputs[0]?.organizationId,
    userId,
    entityType: "EDITION",
    entityId: editionId,
    editionId,
    metadata: { formats: lines.map((line) => line.format) },
  });
  return lines;
}

/** Attach the rendered PDF to the magazine output once a version is published. */
export async function linkMagazineVersion(editionId: string, versionId: string) {
  const output = await db.query.editionOutputs.findFirst({
    where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, "MAGAZINE")),
  });
  if (!output) return null;
  return setOutputStatus(output.id, "PUBLISHED", {
    versionId,
    publishedAt: new Date(),
    generatedAt: new Date(),
  });
}
