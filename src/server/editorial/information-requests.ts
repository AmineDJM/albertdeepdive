import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { contributors, informationRequests, storyCampuses, storyClusterMembers, stories, submissionAttachments, submissionCampuses, submissions, users, type InfoRequestItem, type MissingInformationItem } from "@/server/db/schema";
import { audit, recordDecision } from "@/server/audit";
import { generateOpaqueToken, hashToken } from "@/server/auth/tokens";
import { sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES } from "@/server/jobs/registry";
import { kickJobRunner } from "@/server/jobs/runner";
import { createLogger } from "@/server/logger";
import { ingestMedia } from "@/server/media/ingest";
import { CONSENT_TEXT_VERSION } from "@/lib/constants";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { wordCount } from "@/lib/editorial/text";
import { informationRequestAnsweredEmail, informationRequestEmail } from "./emails";
import { notifyUsers } from "./notifications";
import { newsletterFor, newsletterForEdition } from "@/server/publication/naming";

const log = createLogger("editorial:info-requests");

export const INFO_REQUEST_TTL_DAYS = 21;

export type InformationRequestRow = typeof informationRequests.$inferSelect;

const itemSchema = z.object({ key: z.string().min(1).max(64), label: z.string().min(1).max(500) });

export const createInformationRequestSchema = z.object({
  storyId: z.string().uuid(),
  submissionId: z.string().uuid().nullable().optional(),
  contributorId: z.string().uuid(),
  items: z.array(itemSchema).min(1),
  message: z.string().min(1).max(4000),
  userId: z.string().uuid(),
});
export type CreateInformationRequestInput = z.infer<typeof createInformationRequestSchema>;

export function respondUrl(token: string): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/respond/${token}`;
}

/** Creates a request, emails the contributor a personal link (valid 21 days) and notifies the requester. */
export async function createInformationRequest(input: CreateInformationRequestInput): Promise<{ request: InformationRequestRow; token: string; url: string; emailId: string | null }> {
  const parsed = createInformationRequestSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError("Invalid information request", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])));
  const data = parsed.data;
  const story = await db.query.stories.findFirst({ where: eq(stories.id, data.storyId), with: { edition: { columns: { id: true, label: true } } } });
  if (!story) throw new NotFoundError("Story");
  const contributor = await db.query.contributors.findFirst({ where: eq(contributors.id, data.contributorId) });
  if (!contributor) throw new NotFoundError("Contributor");
  if (data.submissionId) {
    const sub = await db.query.submissions.findFirst({ where: eq(submissions.id, data.submissionId), columns: { editionId: true } });
    if (!sub || sub.editionId !== story.editionId) throw new ValidationError("The submission does not belong to this edition");
  }
  const requester = await db.query.users.findFirst({ where: eq(users.id, data.userId), columns: { id: true, name: true } });
  const { token, hash } = generateOpaqueToken();
  const tokenExpiresAt = new Date(Date.now() + INFO_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000);
  const seen = new Set<string>();
  const items: InfoRequestItem[] = data.items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true))).map((i) => ({ key: i.key, label: i.label, answered: false }));
  const [request] = await db
    .insert(informationRequests)
    .values({ editionId: story.editionId, storyId: story.id, submissionId: data.submissionId ?? null, contributorId: contributor.id, requestedById: data.userId, message: data.message, items, tokenHash: hash, tokenExpiresAt, status: "PENDING" })
    .returning();
  const url = respondUrl(token);
  // Whose newsletter this contributor is being written to about.
  const newsletter = await newsletterForEdition(story.editionId);
  const email = informationRequestEmail({ contributorFirstName: contributor.firstName, storyTitle: story.title, publicationName: newsletter.name, editionLabel: story.edition.label, requesterName: requester?.name ?? null, message: data.message, items, url, expiresAt: tokenExpiresAt });
  const sent = await sendEmail({ to: contributor.email, subject: email.subject, layout: email.layout, template: "information_request", entityType: "INFORMATION_REQUEST", entityId: request.id, editionId: story.editionId, contributorId: contributor.id });
  const [updated] = await db
    .update(informationRequests)
    .set(sent.ok ? { status: "SENT", sentAt: new Date() } : { status: "PENDING" })
    .where(eq(informationRequests.id, request.id))
    .returning();
  await notifyUsers([data.userId], { type: "MISSING_INFORMATION", title: `Information request sent to ${contributor.firstName} ${contributor.lastName}`, body: `${items.length} question(s) about “${story.title}”. The link expires in ${INFO_REQUEST_TTL_DAYS} days.`, entityType: "STORY", entityId: story.id, href: `/stories/${story.id}` });
  await audit({ action: "information_request.create", userId: data.userId, entityType: "INFORMATION_REQUEST", entityId: request.id, editionId: story.editionId, metadata: { storyId: story.id, contributorId: contributor.id, items: items.map((i) => i.key), emailOk: sent.ok } });
  log.info("information request created", { requestId: request.id, storyId: story.id, emailOk: sent.ok });
  return { request: updated, token, url, emailId: sent.id ?? null };
}

export type ResolvedInformationRequest =
  | { state: "invalid" }
  | { state: "expired"; storyTitle: string }
  | { state: "answered"; storyTitle: string; answeredAt: Date | null }
  | { state: "cancelled"; storyTitle: string }
  | { state: "valid"; request: { id: string; message: string; items: InfoRequestItem[]; expiresAt: Date }; storyTitle: string; publicationName: string; editionLabel: string; contributorFirstName: string; requesterName: string | null };

/** Public-safe view of a request for the answer page. */
export async function resolveInformationRequest(token: string): Promise<ResolvedInformationRequest> {
  if (!token || token.length < 16 || token.length > 200) return { state: "invalid" };
  const request = await db.query.informationRequests.findFirst({ where: eq(informationRequests.tokenHash, hashToken(token)), with: { story: { columns: { title: true }, with: { edition: { columns: { label: true, publicationId: true } } } }, contributor: { columns: { firstName: true } }, requestedBy: { columns: { name: true } } } });
  if (!request) return { state: "invalid" };
  const storyTitle = request.story?.title ?? "your contribution";
  if (request.status === "ANSWERED") return { state: "answered", storyTitle, answeredAt: request.answeredAt };
  if (request.status === "CANCELLED") return { state: "cancelled", storyTitle };
  if (request.status === "EXPIRED" || request.tokenExpiresAt.getTime() < Date.now()) {
    if (request.status !== "EXPIRED") await db.update(informationRequests).set({ status: "EXPIRED" }).where(eq(informationRequests.id, request.id));
    return { state: "expired", storyTitle };
  }
  return {
    state: "valid",
    request: { id: request.id, message: request.message, items: request.items, expiresAt: request.tokenExpiresAt },
    storyTitle,
    publicationName: (await newsletterFor(request.story?.edition?.publicationId ?? null)).name,
    editionLabel: request.story?.edition?.label ?? "",
    contributorFirstName: request.contributor?.firstName ?? "",
    requesterName: request.requestedBy?.name ?? null,
  };
}

export type AnswerFile = { buffer: Buffer; fileName: string; mimeType?: string };

export const answerSchema = z.object({
  answers: z.record(z.string(), z.string().max(5000)),
  freeText: z.string().max(10000).optional().nullable(),
});

function formatAnswers(items: InfoRequestItem[], answers: Record<string, string>, freeText: string | null | undefined): string {
  const parts: string[] = [];
  for (const item of items) {
    const answer = answers[item.key]?.trim();
    if (answer) parts.push(`${item.label}\n${answer}`);
  }
  if (freeText?.trim()) parts.push(`Additional information\n${freeText.trim()}`);
  return parts.join("\n\n");
}

/**
 * Records a contributor's answers: creates a follow-up submission attached to the story's cluster,
 * marks the request answered, ticks the matching missing-information items and notifies the requester.
 */
export async function answerInformationRequest(token: string, input: { answers: Record<string, string>; freeText?: string | null; files?: AnswerFile[] }) {
  const parsed = answerSchema.safeParse({ answers: input.answers ?? {}, freeText: input.freeText ?? null });
  if (!parsed.success) throw new ValidationError("Invalid answers", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])));
  const request = await db.query.informationRequests.findFirst({ where: eq(informationRequests.tokenHash, hashToken(token)), with: { story: true, contributor: true, requestedBy: { columns: { id: true, name: true, email: true } } } });
  if (!request) throw new NotFoundError("Information request");
  if (request.status === "ANSWERED") throw new ValidationError("This request has already been answered");
  if (request.status === "CANCELLED") throw new ValidationError("This request was cancelled");
  if (request.tokenExpiresAt.getTime() < Date.now()) {
    await db.update(informationRequests).set({ status: "EXPIRED" }).where(eq(informationRequests.id, request.id));
    throw new ValidationError("This link has expired");
  }
  const answers = parsed.data.answers;
  const items = request.items.map((i) => ({ ...i, answer: answers[i.key]?.trim() || undefined, answered: !!answers[i.key]?.trim() }));
  const answeredKeys = items.filter((i) => i.answered).map((i) => i.key);
  const description = formatAnswers(request.items, answers, parsed.data.freeText);
  if (!description.trim() && !(input.files?.length)) throw new ValidationError("Please answer at least one question", { answers: ["At least one answer is required"] });
  const story = request.story;
  if (!story) throw new NotFoundError("Story");
  const original = request.submissionId ? await db.query.submissions.findFirst({ where: eq(submissions.id, request.submissionId) }) : null;
  const storyCampusRows = await db.query.storyCampuses.findMany({ where: eq(storyCampuses.storyId, story.id) });
  const campusIds = storyCampusRows.map((c) => c.campusId);
  const text = description || "(photos attached)";
  const [submission] = await db
    .insert(submissions)
    .values({
      editionId: request.editionId,
      campaignId: original?.campaignId ?? null,
      requestId: original?.requestId ?? null,
      contributorId: request.contributorId,
      storyType: story.storyType,
      title: `Re: ${story.title}`,
      campusScope: campusIds.length === 0 ? "SCHOOL_WIDE" : campusIds.length > 1 ? "MULTI" : "SINGLE",
      eventDateText: original?.eventDateText ?? null,
      description: text,
      contactName: request.contributor ? `${request.contributor.firstName} ${request.contributor.lastName}` : null,
      contactEmail: request.contributor?.email ?? null,
      extra: { informationRequestId: request.id, answers: Object.fromEntries(items.filter((i) => i.answered).map((i) => [i.key, i.answer])) },
      language: request.contributor?.preferredLanguage ?? "en",
      status: "NEEDS_REVIEW",
      source: "info_request",
      publicationConsent: original?.publicationConsent ?? true,
      imageRightsConfirmed: original?.imageRightsConfirmed ?? false,
      consentTextVersion: original?.consentTextVersion ?? CONSENT_TEXT_VERSION,
      wordCount: wordCount(text),
      submittedAt: new Date(),
    })
    .returning();
  if (campusIds.length) await db.insert(submissionCampuses).values(campusIds.map((campusId) => ({ submissionId: submission.id, campusId }))).onConflictDoNothing();
  if (story.clusterId) {
    await db.insert(storyClusterMembers).values({ clusterId: story.clusterId, submissionId: submission.id, similarity: null, isPrimary: false, addedByAi: false }).onConflictDoNothing();
    await db.update(submissions).set({ suggestedClusterId: story.clusterId }).where(eq(submissions.id, submission.id));
  }
  let attached = 0;
  for (const [i, file] of (input.files ?? []).entries()) {
    try {
      const { asset } = await ingestMedia({ buffer: file.buffer, fileName: file.fileName, mimeType: file.mimeType, editionId: request.editionId, submissionId: submission.id, contributorId: request.contributorId, rightsStatus: "YELLOW", rightsNote: "Sent in answer to an information request: confirm rights before publication." });
      await db.insert(submissionAttachments).values({ submissionId: submission.id, mediaAssetId: asset.id, kind: "IMAGE", fileName: file.fileName, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, storageKey: asset.storageKey, sortOrder: i });
      attached += 1;
    } catch (err) {
      log.warn("attachment ingest failed", { requestId: request.id, fileName: file.fileName, err });
    }
  }
  const [updatedRequest] = await db
    .update(informationRequests)
    .set({ status: "ANSWERED", items, answerText: description || null, answerSubmissionId: submission.id, answeredAt: new Date() })
    .where(eq(informationRequests.id, request.id))
    .returning();
  const missing: MissingInformationItem[] = story.missingInformation.map((m) => (answeredKeys.includes(m.key) ? { ...m, resolved: true } : m));
  await db.update(stories).set({ missingInformation: missing }).where(eq(stories.id, story.id));
  await recordDecision({ editionId: request.editionId, entityType: "INFORMATION_REQUEST", entityId: request.id, decision: "INFORMATION_REQUEST_ANSWER", previousValue: { status: request.status }, newValue: { status: "ANSWERED", submissionId: submission.id, answered: answeredKeys, attachments: attached }, userId: null });
  await audit({ action: "information_request.answer", actorType: "CONTRIBUTOR", entityType: "INFORMATION_REQUEST", entityId: request.id, editionId: request.editionId, metadata: { submissionId: submission.id, answered: answeredKeys, attachments: attached } });
  if (request.requestedBy) {
    const contributorName = request.contributor ? `${request.contributor.firstName} ${request.contributor.lastName}` : "The contributor";
    await notifyUsers([request.requestedBy.id], { type: "MISSING_INFORMATION", title: `${contributorName} answered your information request`, body: `${answeredKeys.length} of ${request.items.length} question(s) answered for “${story.title}”.`, entityType: "STORY", entityId: story.id, href: `/stories/${story.id}` });
    const email = informationRequestAnsweredEmail({ requesterName: request.requestedBy.name, contributorName, storyTitle: story.title, url: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/stories/${story.id}` });
    await sendEmail({ to: request.requestedBy.email, subject: email.subject, layout: email.layout, template: "information_request_answered", entityType: "INFORMATION_REQUEST", entityId: request.id, editionId: request.editionId });
  }
  try {
    await enqueueJob({ type: JOB_TYPES.SUBMISSION_PROCESS, payload: { submissionId: submission.id }, idempotencyKey: `submission.process:${submission.id}`, editionId: request.editionId });
    kickJobRunner();
  } catch (err) {
    log.warn("could not enqueue processing of the follow-up submission", { submissionId: submission.id, err });
  }
  return { request: updatedRequest, submission, answeredKeys, attachments: attached };
}

export async function cancelInformationRequest(requestId: string, userId: string, reason?: string | null) {
  const request = await db.query.informationRequests.findFirst({ where: eq(informationRequests.id, requestId) });
  if (!request) throw new NotFoundError("Information request");
  if (request.status === "ANSWERED") throw new ValidationError("An answered request cannot be cancelled");
  const [row] = await db.update(informationRequests).set({ status: "CANCELLED" }).where(eq(informationRequests.id, requestId)).returning();
  await recordDecision({ editionId: request.editionId, entityType: "INFORMATION_REQUEST", entityId: requestId, decision: "INFORMATION_REQUEST_CANCEL", reason: reason ?? null, previousValue: { status: request.status }, newValue: { status: "CANCELLED" }, userId });
  return row;
}

export async function listInformationRequests(storyId: string) {
  return db.query.informationRequests.findMany({ where: eq(informationRequests.storyId, storyId), orderBy: [desc(informationRequests.createdAt)], with: { contributor: { columns: { id: true, firstName: true, lastName: true, email: true } }, requestedBy: { columns: { id: true, name: true } } } });
}

/** Pre-fills a request from the story's unresolved missing-information items and its primary contributor. */
export async function suggestInformationRequest(storyId: string) {
  const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId), with: { cluster: { with: { members: true } }, edition: { columns: { id: true, label: true, publicationId: true } } } });
  if (!story) throw new NotFoundError("Story");
  const memberIds = story.cluster?.members.map((m) => m.submissionId) ?? [];
  const primaryId = story.cluster?.members.find((m) => m.isPrimary)?.submissionId ?? memberIds[0] ?? null;
  const primary = primaryId ? await db.query.submissions.findFirst({ where: eq(submissions.id, primaryId), with: { contributor: { columns: { id: true, firstName: true, lastName: true, email: true } } } }) : null;
  const pending = await db.query.informationRequests.findMany({ where: and(eq(informationRequests.storyId, storyId), eq(informationRequests.status, "SENT")) });
  const alreadyAsked = new Set(pending.flatMap((r) => r.items.map((i) => i.key)));
  const items = story.missingInformation.filter((m) => !m.resolved && !alreadyAsked.has(m.key)).map((m) => ({ key: m.key, label: m.label, severity: m.severity }));
  const firstName = primary?.contributor?.firstName ?? "there";
  const suggested = await newsletterForEdition(story.editionId);
  const message = `Hi ${firstName}, thank you for your contribution to ${suggested.name} (${story.edition.label}). We are writing the story “${story.title}” and need a few details to make it accurate and complete. Could you answer the questions below?`;
  return {
    storyId,
    submissionId: primary?.id ?? null,
    contributor: primary?.contributor ?? null,
    items,
    message,
    pendingRequests: pending.length,
  };
}

export type { InfoRequestItem };
