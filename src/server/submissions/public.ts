/**
 * Public contribution flow (no account): resolve a personal link, keep a draft, submit.
 *
 * Every entry point takes the raw token and re-checks ownership: a draft can only be read or
 * changed through the request that created it.
 */
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  campuses,
  consentRecords,
  contributors,
  editions,
  mediaAssets,
  mediaVariants,
  submissionAttachments,
  submissionCampaigns,
  submissionCampuses,
  submissionRequests,
  submissions,
} from "@/server/db/schema";
import { audit } from "@/server/audit";
import { hashIp, hashToken } from "@/server/auth/tokens";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES } from "@/server/jobs/registry";
import { kickJobRunner } from "@/server/jobs/runner";
import { createLogger } from "@/server/logger";
import { getStorage } from "@/server/storage";
import { AppError, NotFoundError, ValidationError } from "@/lib/action-result";
import { CONSENT_TEXT_VERSION, type StoryTypeValue } from "@/lib/constants";
import { wordCount } from "@/lib/utils";
import { campaignPhaseAt, formatZoned, formatZonedLong, isCollectingPhase, type CampaignPhase } from "@/lib/campaigns/schedule";
import { declineSchema, draftPatchSchema, fieldErrorsFromIssues, validateSubmissionPayload, type DraftPatch } from "@/lib/submissions/schemas";
import type { AttachmentDTO, DraftDTO, InvitationDTO } from "@/lib/submissions/dto";
import { ACTIVE_CAMPAIGN_STATUSES } from "@/server/campaigns/service";
import { getContactSettings } from "@/server/campaigns/settings";
import { looksLikeToken } from "@/server/campaigns/tokens";

const log = createLogger("submissions:public");

export type SubmissionRow = typeof submissions.$inferSelect;
export type AttachmentRow = typeof submissionAttachments.$inferSelect;

export type BlockedReason = "NOT_OPEN" | "CLOSED" | "EXPIRED" | "DECLINED";

export type ResolvedInvitation = {
  tokenHash: string;
  request: typeof submissionRequests.$inferSelect;
  campaign: typeof submissionCampaigns.$inferSelect;
  edition: typeof editions.$inferSelect;
  contributor: typeof contributors.$inferSelect;
  campus: typeof campuses.$inferSelect | null;
  phase: CampaignPhase;
  canSubmit: boolean;
  blockedReason: BlockedReason | null;
};

export class InvalidLinkError extends AppError {
  constructor() {
    super("This link is not valid", "INVALID_LINK", 404);
    this.name = "InvalidLinkError";
  }
}

// ── Resolve ────────────────────────────────────────────────────────────────

/** Looks up a personal link. Marks the request OPENED on the first visit. Returns null for unknown tokens. */
export async function resolveInvitation(rawToken: string | null | undefined, opts: { markOpened?: boolean; now?: Date } = {}): Promise<ResolvedInvitation | null> {
  if (!looksLikeToken(rawToken)) return null;
  const now = opts.now ?? new Date();
  const tokenHash = hashToken(rawToken);
  const rows = await db
    .select({ request: submissionRequests, campaign: submissionCampaigns, edition: editions, contributor: contributors, campus: campuses })
    .from(submissionRequests)
    .innerJoin(submissionCampaigns, eq(submissionCampaigns.id, submissionRequests.campaignId))
    .innerJoin(editions, eq(editions.id, submissionRequests.editionId))
    .innerJoin(contributors, eq(contributors.id, submissionRequests.contributorId))
    .leftJoin(campuses, eq(campuses.id, contributors.campusId))
    .where(eq(submissionRequests.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  let request = row.request;
  if (opts.markOpened !== false && request.status === "SENT") {
    const [updated] = await db
      .update(submissionRequests)
      .set({ status: "OPENED", openedAt: request.openedAt ?? now })
      .where(and(eq(submissionRequests.id, request.id), eq(submissionRequests.status, "SENT")))
      .returning();
    if (updated) request = updated;
  }

  const phase = campaignPhaseAt(row.campaign, now);
  const tokenExpired = request.tokenExpiresAt.getTime() <= now.getTime();
  let blockedReason: BlockedReason | null = null;
  if (request.status === "DECLINED") blockedReason = "DECLINED";
  else if (tokenExpired) blockedReason = "EXPIRED";
  else if (row.campaign.status === "CLOSED" || phase === "CLOSED") blockedReason = "CLOSED";
  else if (!ACTIVE_CAMPAIGN_STATUSES.includes(row.campaign.status) || !isCollectingPhase(phase)) blockedReason = "NOT_OPEN";

  return { tokenHash, request, campaign: row.campaign, edition: row.edition, contributor: row.contributor, campus: row.campus, phase, canSubmit: blockedReason === null, blockedReason };
}

async function requireInvitation(rawToken: string, opts: { now?: Date } = {}): Promise<ResolvedInvitation> {
  const resolved = await resolveInvitation(rawToken, { markOpened: false, now: opts.now });
  if (!resolved) throw new InvalidLinkError();
  return resolved;
}

function blockedError(reason: BlockedReason): AppError {
  switch (reason) {
    case "CLOSED":
      return new AppError("Contributions for this issue are closed", "CAMPAIGN_CLOSED", 409);
    case "EXPIRED":
      return new AppError("This link has expired", "LINK_EXPIRED", 410);
    case "DECLINED":
      return new AppError("You declined this invitation", "DECLINED", 409);
    default:
      return new AppError("Contributions are not open yet", "CAMPAIGN_NOT_OPEN", 409);
  }
}

// ── DTOs ───────────────────────────────────────────────────────────────────

export async function listActiveCampuses() {
  return db
    .select({ id: campuses.id, name: campuses.name, slug: campuses.slug, colour: campuses.colour })
    .from(campuses)
    .where(eq(campuses.isActive, true))
    .orderBy(asc(campuses.sortOrder));
}

export async function attachmentDTOs(submissionId: string): Promise<AttachmentDTO[]> {
  const rows = await db
    .select({ attachment: submissionAttachments, width: mediaAssets.width, height: mediaAssets.height })
    .from(submissionAttachments)
    .leftJoin(mediaAssets, eq(mediaAssets.id, submissionAttachments.mediaAssetId))
    .where(eq(submissionAttachments.submissionId, submissionId))
    .orderBy(asc(submissionAttachments.sortOrder), asc(submissionAttachments.createdAt));
  const assetIds = rows.map((r) => r.attachment.mediaAssetId).filter((id): id is string => !!id);
  const thumbs = assetIds.length
    ? await db
        .select({ assetId: mediaVariants.assetId, key: mediaVariants.storageKey })
        .from(mediaVariants)
        .where(and(inArray(mediaVariants.assetId, assetIds), eq(mediaVariants.kind, "THUMBNAIL")))
    : [];
  const thumbKey = new Map(thumbs.map((t) => [t.assetId, t.key]));
  const storage = await getStorage();
  const out: AttachmentDTO[] = [];
  for (const r of rows) {
    const key = r.attachment.mediaAssetId ? thumbKey.get(r.attachment.mediaAssetId) : undefined;
    out.push(toAttachmentDTO(r.attachment, { width: r.width, height: r.height }, key ? await storage.getSignedUrl(key, { expiresInSeconds: 3600 }) : null));
  }
  return out;
}

export function toAttachmentDTO(row: AttachmentRow, dims: { width: number | null; height: number | null }, thumbnailUrl: string | null): AttachmentDTO {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    caption: row.caption,
    photographer: row.photographer,
    thumbnailUrl,
    width: dims.width,
    height: dims.height,
    sortOrder: row.sortOrder,
  };
}

export async function toDraftDTO(row: SubmissionRow): Promise<DraftDTO> {
  const campusRows = await db.select({ campusId: submissionCampuses.campusId }).from(submissionCampuses).where(eq(submissionCampuses.submissionId, row.id));
  return {
    id: row.id,
    storyType: row.storyType as StoryTypeValue,
    title: row.title,
    campusIds: campusRows.map((c) => c.campusId),
    eventDateText: row.eventDateText ?? "",
    description: row.description,
    peopleInvolved: row.peopleInvolved ?? "",
    organisationsInvolved: row.organisationsInvolved ?? "",
    whyItMatters: row.whyItMatters ?? "",
    quotes: row.quotes ?? "",
    urls: row.urls,
    contactName: row.contactName ?? "",
    contactEmail: row.contactEmail ?? "",
    extra: row.extra ?? {},
    publicationConsent: row.publicationConsent,
    imageRightsConfirmed: row.imageRightsConfirmed,
    attachments: await attachmentDTOs(row.id),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function toInvitationDTO(resolved: ResolvedInvitation, opts: { includeDraft?: boolean } = {}): Promise<InvitationDTO> {
  const [campusList, contact, submitted] = await Promise.all([
    listActiveCampuses(),
    getContactSettings(),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(submissions)
      .where(and(eq(submissions.requestId, resolved.request.id), ne(submissions.status, "DRAFT"))),
  ]);
  const draft = opts.includeDraft === false ? null : await findDraft(resolved.request.id);
  return {
    requestId: resolved.request.id,
    status: resolved.request.status,
    phase: resolved.phase,
    canSubmit: resolved.canSubmit,
    blockedReason: resolved.blockedReason,
    contributor: {
      firstName: resolved.contributor.firstName,
      lastName: resolved.contributor.lastName,
      email: resolved.contributor.email,
      campusId: resolved.contributor.campusId,
      campusName: resolved.campus?.name ?? null,
    },
    edition: { id: resolved.edition.id, label: resolved.edition.label, title: resolved.edition.title, issueNumber: resolved.edition.issueNumber },
    campaign: {
      id: resolved.campaign.id,
      name: resolved.campaign.name,
      introMessage: resolved.campaign.introMessage,
      opensAt: resolved.campaign.opensAt.toISOString(),
      deadlineAt: resolved.campaign.deadlineAt.toISOString(),
      graceEndsAt: resolved.campaign.graceEndsAt.toISOString(),
      status: resolved.campaign.status,
    },
    campuses: campusList,
    labels: {
      opensLong: formatZonedLong(resolved.campaign.opensAt),
      deadline: formatZoned(resolved.campaign.deadlineAt, { weekday: "short" }),
      deadlineLong: formatZonedLong(resolved.campaign.deadlineAt),
      graceEnds: formatZoned(resolved.campaign.graceEndsAt),
      graceEndsLong: formatZonedLong(resolved.campaign.graceEndsAt),
    },
    submittedCount: submitted[0]?.n ?? 0,
    contactEmail: contact.email,
    consentTextVersion: CONSENT_TEXT_VERSION,
    draft: draft ? await toDraftDTO(draft) : null,
  };
}

// ── Drafts ─────────────────────────────────────────────────────────────────

async function findDraft(requestId: string): Promise<SubmissionRow | null> {
  const row = await db.query.submissions.findFirst({ where: and(eq(submissions.requestId, requestId), eq(submissions.status, "DRAFT")), orderBy: [desc(submissions.updatedAt)] });
  return row ?? null;
}

async function createDraft(resolved: ResolvedInvitation): Promise<SubmissionRow> {
  const { request, contributor } = resolved;
  const [row] = await db
    .insert(submissions)
    .values({
      editionId: request.editionId,
      campaignId: request.campaignId,
      requestId: request.id,
      contributorId: contributor.id,
      storyType: "OTHER",
      title: "",
      description: "",
      campusScope: contributor.campusId ? "SINGLE" : "SCHOOL_WIDE",
      contactName: `${contributor.firstName} ${contributor.lastName}`.trim(),
      contactEmail: contributor.email,
      language: contributor.preferredLanguage,
      status: "DRAFT",
      source: "form",
    })
    .returning();
  if (contributor.campusId) await db.insert(submissionCampuses).values({ submissionId: row.id, campusId: contributor.campusId }).onConflictDoNothing();
  return row;
}

async function resolveRequestById(requestId: string): Promise<ResolvedInvitation> {
  const request = await db.query.submissionRequests.findFirst({ where: eq(submissionRequests.id, requestId) });
  if (!request) throw new NotFoundError("Invitation");
  const [campaign, edition, contributor] = await Promise.all([
    db.query.submissionCampaigns.findFirst({ where: eq(submissionCampaigns.id, request.campaignId) }),
    db.query.editions.findFirst({ where: eq(editions.id, request.editionId) }),
    db.query.contributors.findFirst({ where: eq(contributors.id, request.contributorId) }),
  ]);
  if (!campaign || !edition || !contributor) throw new NotFoundError("Invitation");
  const campus = contributor.campusId ? ((await db.query.campuses.findFirst({ where: eq(campuses.id, contributor.campusId) })) ?? null) : null;
  const phase = campaignPhaseAt(campaign);
  return { tokenHash: request.tokenHash, request, campaign, edition, contributor, campus, phase, canSubmit: isCollectingPhase(phase), blockedReason: null };
}

/** The current draft of a request, created on first use with the contributor's details prefilled. */
export async function getOrCreateDraft(requestId: string): Promise<DraftDTO> {
  const existing = await findDraft(requestId);
  if (existing) return toDraftDTO(existing);
  const resolved = await resolveRequestById(requestId);
  return toDraftDTO(await createDraft(resolved));
}

/** A fresh, empty draft for "submit another story". */
export async function startAnotherDraft(requestId: string): Promise<DraftDTO> {
  const resolved = await resolveRequestById(requestId);
  return toDraftDTO(await createDraft(resolved));
}

/** Loads a draft and verifies it belongs to the invitation behind `rawToken`. */
export async function requireOwnedDraft(submissionId: string, rawToken: string, opts: { now?: Date } = {}): Promise<{ resolved: ResolvedInvitation; draft: SubmissionRow }> {
  const resolved = await requireInvitation(rawToken, opts);
  const draft = await db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!draft || draft.requestId !== resolved.request.id) throw new NotFoundError("Draft");
  if (draft.status !== "DRAFT") throw new AppError("This story has already been sent", "ALREADY_SUBMITTED", 409);
  return { resolved, draft };
}

async function replaceCampuses(submissionId: string, campusIds: string[]) {
  const unique = [...new Set(campusIds)];
  if (unique.length) {
    const known = await db.select({ id: campuses.id }).from(campuses).where(and(inArray(campuses.id, unique), eq(campuses.isActive, true)));
    if (known.length !== unique.length) throw new ValidationError("Unknown campus", { campusIds: ["Pick campuses from the list"] });
  }
  await db.delete(submissionCampuses).where(eq(submissionCampuses.submissionId, submissionId));
  if (unique.length) await db.insert(submissionCampuses).values(unique.map((campusId) => ({ submissionId, campusId })));
  return unique.length === 0 ? ("SCHOOL_WIDE" as const) : unique.length === 1 ? ("SINGLE" as const) : ("MULTI" as const);
}

function patchToColumns(patch: DraftPatch): Partial<typeof submissions.$inferInsert> {
  const set: Partial<typeof submissions.$inferInsert> = {};
  if (patch.storyType !== undefined) set.storyType = patch.storyType;
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.eventDateText !== undefined) set.eventDateText = patch.eventDateText || null;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.peopleInvolved !== undefined) set.peopleInvolved = patch.peopleInvolved || null;
  if (patch.organisationsInvolved !== undefined) set.organisationsInvolved = patch.organisationsInvolved || null;
  if (patch.whyItMatters !== undefined) set.whyItMatters = patch.whyItMatters || null;
  if (patch.quotes !== undefined) set.quotes = patch.quotes || null;
  if (patch.urls !== undefined) set.urls = patch.urls.map((u) => u.trim()).filter(Boolean);
  if (patch.contactName !== undefined) set.contactName = patch.contactName || null;
  if (patch.contactEmail !== undefined) set.contactEmail = patch.contactEmail || null;
  if (patch.publicationConsent !== undefined) set.publicationConsent = patch.publicationConsent;
  if (patch.imageRightsConfirmed !== undefined) set.imageRightsConfirmed = patch.imageRightsConfirmed;
  if (patch.extra !== undefined) set.extra = patch.extra;
  return set;
}

/** Autosave: lenient partial update of a draft. */
export async function saveDraft(submissionId: string, rawToken: string, patch: unknown, opts: { now?: Date } = {}): Promise<{ savedAt: string; draftId: string }> {
  const { draft } = await requireOwnedDraft(submissionId, rawToken, opts);
  const parsed = draftPatchSchema.safeParse(patch);
  if (!parsed.success) throw new ValidationError("Could not save the draft", fieldErrorsFromIssues(parsed.error.issues));
  const set = patchToColumns(parsed.data);
  if (parsed.data.campusIds !== undefined) set.campusScope = await replaceCampuses(draft.id, parsed.data.campusIds);
  const now = opts.now ?? new Date();
  await db
    .update(submissions)
    .set({ ...set, updatedAt: now })
    .where(eq(submissions.id, draft.id));
  return { savedAt: now.toISOString(), draftId: draft.id };
}

// ── Submit ─────────────────────────────────────────────────────────────────

export type SubmitMeta = { ip?: string | null; userAgent?: string | null };

function textForWordCount(data: Record<string, unknown>) {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "extra" && value && typeof value === "object") {
      for (const v of Object.values(value as Record<string, unknown>)) if (typeof v === "string") parts.push(v);
      continue;
    }
    if (typeof value === "string") parts.push(value);
  }
  return parts.join("\n");
}

/** Final submission: full validation, consent records, request + contributor stats, AI processing job. */
export async function submitDraft(submissionId: string, rawToken: string, payload: unknown, meta: SubmitMeta, opts: { now?: Date } = {}): Promise<{ submissionId: string }> {
  const now = opts.now ?? new Date();
  const { resolved, draft } = await requireOwnedDraft(submissionId, rawToken, { now });
  if (!resolved.canSubmit && resolved.blockedReason) throw blockedError(resolved.blockedReason);

  const attachments = await db
    .select({ kind: submissionAttachments.kind, mediaAssetId: submissionAttachments.mediaAssetId })
    .from(submissionAttachments)
    .where(eq(submissionAttachments.submissionId, draft.id));
  const hasPhotos = attachments.some((a) => a.kind === "IMAGE");
  const validation = validateSubmissionPayload(payload, { hasPhotos });
  if (!validation.ok) throw new ValidationError(validation.error, validation.fieldErrors);
  const data = validation.data;

  const { request, contributor, campaign, edition } = resolved;
  const ipHash = hashIp(meta.ip ?? null);
  const userAgent = meta.userAgent?.slice(0, 300) ?? null;
  const words = wordCount(
    textForWordCount({
      title: data.title,
      description: data.description,
      peopleInvolved: data.peopleInvolved,
      organisationsInvolved: data.organisationsInvolved,
      whyItMatters: data.whyItMatters,
      quotes: data.quotes,
      extra: data.extra,
    }),
  );

  await db.transaction(async (tx) => {
    const unique = [...new Set(data.campusIds)];
    if (unique.length) {
      const known = await tx.select({ id: campuses.id }).from(campuses).where(and(inArray(campuses.id, unique), eq(campuses.isActive, true)));
      if (known.length !== unique.length) throw new ValidationError("Unknown campus", { campusIds: ["Pick campuses from the list"] });
    }
    await tx.delete(submissionCampuses).where(eq(submissionCampuses.submissionId, draft.id));
    if (unique.length) await tx.insert(submissionCampuses).values(unique.map((campusId) => ({ submissionId: draft.id, campusId })));

    await tx
      .update(submissions)
      .set({
        storyType: data.storyType,
        title: data.title,
        campusScope: unique.length === 0 ? "SCHOOL_WIDE" : unique.length === 1 ? "SINGLE" : "MULTI",
        eventDateText: data.eventDateText || null,
        description: data.description,
        peopleInvolved: data.peopleInvolved || null,
        organisationsInvolved: data.organisationsInvolved || null,
        whyItMatters: data.whyItMatters || null,
        quotes: data.quotes || null,
        urls: data.urls,
        contactName: data.contactName || `${contributor.firstName} ${contributor.lastName}`.trim(),
        contactEmail: data.contactEmail || contributor.email,
        extra: data.extra,
        status: "NEW",
        publicationConsent: true,
        imageRightsConfirmed: hasPhotos ? data.imageRightsConfirmed : false,
        consentTextVersion: CONSENT_TEXT_VERSION,
        wordCount: words,
        submittedAt: now,
        updatedAt: now,
      })
      .where(eq(submissions.id, draft.id));

    const consents: (typeof consentRecords.$inferInsert)[] = [
      { submissionId: draft.id, contributorId: contributor.id, type: "PUBLICATION", textVersion: CONSENT_TEXT_VERSION, accepted: true, acceptedAt: now, ipHash, userAgent },
    ];
    if (hasPhotos && data.imageRightsConfirmed) {
      consents.push({ submissionId: draft.id, contributorId: contributor.id, type: "IMAGE_RIGHTS", textVersion: CONSENT_TEXT_VERSION, accepted: true, acceptedAt: now, ipHash, userAgent });
      for (const a of attachments) {
        if (!a.mediaAssetId) continue;
        consents.push({ submissionId: draft.id, contributorId: contributor.id, mediaAssetId: a.mediaAssetId, type: "IMAGE_RIGHTS", textVersion: CONSENT_TEXT_VERSION, accepted: true, acceptedAt: now, ipHash, userAgent });
      }
      const assetIds = attachments.map((a) => a.mediaAssetId).filter((id): id is string => !!id);
      if (assetIds.length) await tx.update(mediaAssets).set({ rightsNote: `Contributor confirmed image rights (consent ${CONSENT_TEXT_VERSION}).` }).where(inArray(mediaAssets.id, assetIds));
    }
    await tx.insert(consentRecords).values(consents);

    await tx
      .update(submissionRequests)
      .set({ status: "SUBMITTED", submittedAt: request.submittedAt ?? now, submissionsCount: sql`${submissionRequests.submissionsCount} + 1`, openedAt: request.openedAt ?? now })
      .where(eq(submissionRequests.id, request.id));

    const [responded] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(submissionRequests)
      .where(and(eq(submissionRequests.contributorId, contributor.id), eq(submissionRequests.status, "SUBMITTED")));
    const invitations = Math.max(contributor.invitationsCount, 1);
    await tx
      .update(contributors)
      .set({
        submissionsCount: sql`${contributors.submissionsCount} + 1`,
        lastContributionAt: now,
        responseRate: Math.min(1, Math.max(responded?.n ?? 1, 1) / invitations),
      })
      .where(eq(contributors.id, contributor.id));
  });

  await audit({
    action: "submission.submit",
    actorType: "CONTRIBUTOR",
    entityType: "SUBMISSION",
    entityId: draft.id,
    editionId: edition.id,
    ipHash,
    metadata: { contributorId: contributor.id, campaignId: campaign.id, requestId: request.id, storyType: data.storyType, wordCount: words, attachments: attachments.length, hasPhotos },
  });
  await enqueueJob({ type: JOB_TYPES.SUBMISSION_PROCESS, payload: { submissionId: draft.id }, idempotencyKey: `submission-process:${draft.id}`, editionId: edition.id, priority: 4 });
  kickJobRunner();
  log.info("submission received", { submissionId: draft.id, editionId: edition.id, storyType: data.storyType });
  return { submissionId: draft.id };
}

// ── Decline ────────────────────────────────────────────────────────────────

export async function declineInvitation(rawToken: string, input: unknown = {}, meta: SubmitMeta = {}, opts: { now?: Date } = {}): Promise<{ status: ResolvedInvitation["request"]["status"] }> {
  const resolved = await requireInvitation(rawToken, opts);
  const parsed = declineSchema.safeParse(input ?? {});
  if (!parsed.success) throw new ValidationError("Invalid request", fieldErrorsFromIssues(parsed.error.issues));
  const { request } = resolved;
  const now = opts.now ?? new Date();
  const ipHash = hashIp(meta.ip ?? null);
  if (parsed.data.undo) {
    if (request.status !== "DECLINED") return { status: request.status };
    await db.update(submissionRequests).set({ status: "OPENED", openedAt: request.openedAt ?? now }).where(eq(submissionRequests.id, request.id));
    await audit({ action: "invitation.decline_undo", actorType: "CONTRIBUTOR", entityType: "CAMPAIGN", entityId: request.campaignId, editionId: request.editionId, ipHash, metadata: { requestId: request.id, contributorId: request.contributorId } });
    return { status: "OPENED" };
  }
  if (request.status === "SUBMITTED") throw new AppError("You already sent a story — thank you!", "ALREADY_SUBMITTED", 409);
  if (request.status === "DECLINED") return { status: "DECLINED" };
  await db.update(submissionRequests).set({ status: "DECLINED", openedAt: request.openedAt ?? now }).where(eq(submissionRequests.id, request.id));
  await audit({ action: "invitation.decline", actorType: "CONTRIBUTOR", entityType: "CAMPAIGN", entityId: request.campaignId, editionId: request.editionId, ipHash, metadata: { requestId: request.id, contributorId: request.contributorId, reason: parsed.data.reason ?? null } });
  return { status: "DECLINED" };
}
