import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { sendEmail } from "@/server/email";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { mediaUrls } from "@/server/media/urls";
import { recipientsFor } from "@/server/subscribers/service";
import { renderEditionEmail } from "./email-edition";
import { setOutputStatus } from "./service";
import { NotFoundError, ValidationError } from "@/lib/action-result";

const log = createLogger("outputs");

/**
 * Signed image URLs expire, and an email is read whenever the reader gets to it — sometimes weeks
 * later. Pictures in a sent email are therefore signed for a year rather than for an hour.
 */
const EMAIL_IMAGE_TTL_SECONDS = 400 * 24 * 60 * 60;

export type SendResult = { sent: number; failed: number; skipped: number; outputId: string };

async function loadOutput(editionId: string, format: (typeof s.outputFormatEnum.enumValues)[number]) {
  const output = await db.query.editionOutputs.findFirst({ where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, format)) });
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
export async function sendEditionEmail(editionId: string, userId?: string | null): Promise<SendResult> {
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  if (!edition.publicationId) throw new ValidationError("This edition does not belong to a publication, so it has no subscribers to send to.");

  const output = await loadOutput(editionId, "EMAIL");
  if (output.status === "PUBLISHED") throw new ValidationError("This edition has already been emailed.");

  const [organization, recipients] = await Promise.all([
    edition.organizationId ? db.query.organizations.findFirst({ where: eq(s.organizations.id, edition.organizationId) }) : Promise.resolve(undefined),
    recipientsFor(edition.publicationId),
  ]);

  if (!recipients.length) {
    await setOutputStatus(output.id, "FAILED", { lastError: "Nobody has confirmed a subscription to this title yet." });
    throw new ValidationError("Nobody has confirmed a subscription to this title yet.");
  }

  await setOutputStatus(output.id, "GENERATING", { recipientCount: recipients.length, lastError: null });

  const doc = await buildEditionDocument(editionId, { versionLabel: "email", signedUrlTtlSeconds: EMAIL_IMAGE_TTL_SECONDS });
  const mediaIds = [doc.meta.cover.mediaId, ...doc.articles.map((a) => a.heroMediaId)].filter((id): id is string => !!id);
  const imageUrls = await mediaUrls(mediaIds, "WEB", EMAIL_IMAGE_TTL_SECONDS);

  const webOutput = await db.query.editionOutputs.findFirst({
    where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, "WEB"), eq(s.editionOutputs.status, "PUBLISHED")),
  });
  const webUrl = webOutput?.publicSlug ? `${env.NEXT_PUBLIC_APP_URL}/r/${webOutput.publicSlug}` : null;

  const brand = (organization?.brandColours ?? {}) as { primary?: string; accent?: string };
  const config = output.config ?? {};

  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const unsubscribeUrl = `${env.NEXT_PUBLIC_APP_URL}/s/unsubscribe/${recipient.unsubscribeToken}?p=${edition.publicationId}`;
    const rendered = renderEditionEmail(doc, {
      organizationName: organization?.name ?? doc.meta.masthead.title,
      logoUrl: organization?.logoUrl ?? null,
      accentColour: brand.primary ?? brand.accent ?? null,
      webUrl,
      unsubscribeUrl,
      greetingName: recipient.firstName,
      imageUrls,
      footerNote: typeof config.fromName === "string" ? config.fromName : null,
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
      layout: { title: rendered.subject, blocks: [], rawHtml: rendered.html, rawText: rendered.text },
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
    metadata: { sent, failed, recipients: recipients.length },
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
  const row = await setOutputStatus(output.id, "PUBLISHED", { publishedAt: new Date(), generatedAt: new Date(), lastError: null });
  await audit({ action: "output.web.publish", organizationId: output.organizationId, userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { slug: output.publicSlug } });
  return row;
}

export async function unpublishWebEdition(editionId: string, userId?: string | null) {
  const output = await loadOutput(editionId, "WEB");
  const row = await setOutputStatus(output.id, "READY", { publishedAt: null });
  await audit({ action: "output.web.unpublish", organizationId: output.organizationId, userId, entityType: "EDITION", entityId: editionId, editionId });
  return row;
}

/** Attach the rendered PDF to the magazine output once a version is published. */
export async function linkMagazineVersion(editionId: string, versionId: string) {
  const output = await db.query.editionOutputs.findFirst({ where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, "MAGAZINE")) });
  if (!output) return null;
  return setOutputStatus(output.id, "PUBLISHED", { versionId, publishedAt: new Date(), generatedAt: new Date() });
}
