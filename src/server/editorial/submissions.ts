import { and, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { editionSections, mediaAssets, submissions, type AiClassification, type AiEntities, type AiWarning } from "@/server/db/schema";
import { audit, recordDecision } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { defaultSectionForStoryType } from "@/lib/constants";
import { splitNameList } from "@/lib/editorial/text";
import { classifySubmission, detectDuplicate, extractSubmissionEntities, normalizeSubmission, submissionDuplicateText, type AiServiceContext } from "@/server/ai/services";

const log = createLogger("editorial:submissions");

export type SubmissionStatus = (typeof submissions.$inferSelect)["status"];
type StoryType = (typeof submissions.$inferSelect)["storyType"];

export type ProcessSubmissionResult = {
  submissionId: string;
  skipped: boolean;
  status: SubmissionStatus;
  storyType: StoryType;
  duplicateOfId: string | null;
  aiImportance: number | null;
  aiJobIds: string[];
  costCents: number;
};

const TYPE_WEIGHT: Record<string, number> = {
  BUSINESS_DEEP_DIVE: 0.85,
  INTERVIEW_PROFILE: 0.75,
  STUDENT_ACHIEVEMENT: 0.75,
  STUDENT_PROJECT: 0.7,
  SCHOOL_NEWS: 0.65,
  ASSOCIATION: 0.55,
  EVENT_RECAP: 0.55,
  ALUMNI: 0.55,
  ACADEMIC_NEWS: 0.55,
  UPCOMING_EVENT: 0.5,
  DATA_AI_BUSINESS_INSIGHT: 0.5,
  CAREER_INTERNSHIP: 0.5,
  CAMPUS_LIFE: 0.45,
  ANECDOTE: 0.4,
  PHOTO_STORY: 0.4,
  OTHER: 0.35,
};

/** Heuristic 0–1 importance of a submission for triage ordering in the inbox. */
export function computeImportance(input: { storyType: string; wordCount: number; mediaCount: number; hasQuotes: boolean; hasWhyItMatters: boolean; campusScope: string; confidence: number }): number {
  const base = TYPE_WEIGHT[input.storyType] ?? 0.35;
  const score =
    base * 0.6 +
    Math.min(1, input.wordCount / 400) * 0.15 +
    Math.min(1, input.mediaCount / 3) * 0.1 +
    (input.hasQuotes ? 0.05 : 0) +
    (input.hasWhyItMatters ? 0.05 : 0) +
    (input.campusScope === "SCHOOL_WIDE" ? 0.05 : input.campusScope === "MULTI" ? 0.03 : 0) +
    (input.confidence - 0.5) * 0.04;
  return Math.round(Math.max(0, Math.min(1, score)) * 100) / 100;
}

/**
 * Normalises, classifies, extracts entities and checks duplicates for one submission, then updates
 * its row. Idempotent: an already processed submission is skipped unless `force` is set.
 */
export async function processSubmission(submissionId: string, opts: { force?: boolean; jobId?: string | null } = {}): Promise<ProcessSubmissionResult> {
  const submission = await db.query.submissions.findFirst({
    where: eq(submissions.id, submissionId),
    with: { campuses: { with: { campus: true } }, contributor: true },
  });
  if (!submission) throw new NotFoundError("Submission");
  if (submission.processedAt && !opts.force) {
    return { submissionId, skipped: true, status: submission.status, storyType: submission.storyType, duplicateOfId: submission.duplicateOfId, aiImportance: submission.aiImportance, aiJobIds: [], costCents: 0 };
  }

  const sectionRows = await db.query.editionSections.findMany({ where: eq(editionSections.editionId, submission.editionId) });
  const sectionSlugs = sectionRows.filter((s) => !s.isHidden).map((s) => s.slug);
  const campusNames = submission.campuses.map((c) => c.campus.name);
  const ctx: AiServiceContext = { editionId: submission.editionId, entityType: "SUBMISSION", entityId: submission.id, jobId: opts.jobId ?? null };
  const aiJobIds: string[] = [];
  let costCents = 0;

  const normalized = await normalizeSubmission(
    {
      storyType: submission.storyType,
      campus: campusNames.join(", ") || "school-wide",
      title: submission.title,
      description: submission.description,
      peopleInvolved: submission.peopleInvolved,
      organisationsInvolved: submission.organisationsInvolved,
      whyItMatters: submission.whyItMatters,
      quotes: submission.quotes,
      eventDateText: submission.eventDateText,
      extra: submission.extra,
    },
    ctx,
  );
  aiJobIds.push(normalized.aiJobId);
  costCents += normalized.usage.costCents;
  const text = normalized.output.normalizedText || submission.description;

  const classification = await classifySubmission({ text, declaredType: submission.storyType, sectionSlugs }, ctx);
  aiJobIds.push(classification.aiJobId);
  costCents += classification.usage.costCents;

  const entities = await extractSubmissionEntities({ text, knownOrganisations: submission.organisationsInvolved ? splitNameList(submission.organisationsInvolved) : [] }, ctx);
  aiJobIds.push(entities.aiJobId);
  costCents += entities.usage.costCents;

  // Duplicate detection against earlier submissions of the same edition (pure code).
  const others = await db
    .select({ id: submissions.id, title: submissions.title, description: submissions.description, normalizedText: submissions.normalizedText })
    .from(submissions)
    .where(and(eq(submissions.editionId, submission.editionId), ne(submissions.id, submission.id), lte(submissions.createdAt, submission.createdAt), sql`${submissions.status} not in ('REJECTED', 'ARCHIVED', 'DRAFT')`));
  const duplicate = detectDuplicate(
    { id: submission.id, text: submissionDuplicateText(submission) },
    others.map((o) => ({ id: o.id, text: submissionDuplicateText(o) })),
  );

  const [mediaRow] = await db.select({ n: sql<number>`count(*)::int` }).from(mediaAssets).where(and(eq(mediaAssets.submissionId, submission.id), eq(mediaAssets.isArchived, false)));
  const mediaCount = Number(mediaRow?.n ?? 0);

  const warnings: AiWarning[] = [];
  if (duplicate.duplicateOfId) warnings.push({ code: "DUPLICATE", message: `${duplicate.exact ? "Identical" : "Near-identical"} to submission ${duplicate.duplicateOfId} (${Math.round(duplicate.similarity * 100)}% similar).`, severity: "warning" });
  if (!submission.publicationConsent) warnings.push({ code: "NO_PUBLICATION_CONSENT", message: "The contributor has not confirmed publication consent.", severity: "error" });
  if (mediaCount > 0 && !submission.imageRightsConfirmed) warnings.push({ code: "IMAGE_RIGHTS_UNCONFIRMED", message: "Photos were attached without confirming image rights.", severity: "warning" });
  if (normalized.output.wordCount < 40) warnings.push({ code: "VERY_SHORT", message: `Only ${normalized.output.wordCount} words: the story may need an information request.`, severity: "info" });
  if (classification.output.storyType !== submission.storyType) warnings.push({ code: "TYPE_MISMATCH", message: `Declared as ${submission.storyType}, classified as ${classification.output.storyType}.`, severity: "info" });
  if (classification.output.language && classification.output.language !== "en") warnings.push({ code: "LANGUAGE", message: `Written in "${classification.output.language}": translate before publication.`, severity: "info" });
  if (mediaCount === 0) warnings.push({ code: "NO_MEDIA", message: "No photo attached.", severity: "info" });

  const storyType = classification.output.storyType as StoryType;
  const aiImportance = computeImportance({ storyType, wordCount: normalized.output.wordCount, mediaCount, hasQuotes: !!submission.quotes?.trim() || /[“"«]/.test(submission.description), hasWhyItMatters: !!submission.whyItMatters?.trim(), campusScope: submission.campusScope, confidence: classification.output.confidence });
  const preferredSection = sectionSlugs.includes(classification.output.sectionSlug) ? classification.output.sectionSlug : defaultSectionForStoryType(storyType);
  const suggestedSectionSlug = sectionSlugs.length === 0 || sectionSlugs.includes(preferredSection) ? preferredSection : null;

  const aiClassification: AiClassification = {
    storyType: classification.output.storyType,
    sectionSlug: suggestedSectionSlug ?? classification.output.sectionSlug,
    confidence: classification.output.confidence,
    tags: classification.output.tags,
    language: classification.output.language,
    summary: normalized.output.summary,
    reasons: classification.output.reason,
  };
  const aiEntities: AiEntities = {
    people: entities.output.people,
    organisations: entities.output.organisations,
    dates: entities.output.dates.map((d) => ({ text: d.text, iso: d.iso ?? undefined })),
    places: entities.output.places,
    metrics: entities.output.metrics,
  };
  const unreviewed = !submission.reviewedById && ["NEW", "NEEDS_REVIEW", "DUPLICATE"].includes(submission.status);
  const status: SubmissionStatus = unreviewed ? (duplicate.duplicateOfId ? "DUPLICATE" : "NEEDS_REVIEW") : submission.status;

  const [updated] = await db
    .update(submissions)
    .set({
      normalizedText: text,
      wordCount: normalized.output.wordCount,
      aiSummary: normalized.output.summary,
      aiClassification,
      aiEntities,
      aiWarnings: warnings,
      aiImportance,
      suggestedSectionSlug,
      duplicateOfId: duplicate.duplicateOfId,
      status,
      language: classification.output.language || submission.language,
      processedAt: new Date(),
    })
    .where(eq(submissions.id, submission.id))
    .returning();

  await audit({
    action: "submission.process",
    actorType: "AI",
    entityType: "SUBMISSION",
    entityId: submission.id,
    editionId: submission.editionId,
    metadata: { storyType, declaredType: submission.storyType, duplicateOfId: duplicate.duplicateOfId, status, aiJobIds, forced: !!opts.force },
  });
  log.info("submission processed", { submissionId, storyType, status, duplicateOfId: duplicate.duplicateOfId, costCents });
  return { submissionId, skipped: false, status: updated.status, storyType: updated.storyType, duplicateOfId: updated.duplicateOfId, aiImportance: updated.aiImportance, aiJobIds, costCents };
}

export const REVIEW_STATUSES = ["NEEDS_REVIEW", "MISSING_INFO", "DUPLICATE", "POTENTIAL_STORY", "ACCEPTED", "REJECTED", "ARCHIVED"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Records an editor's triage decision on a submission. */
export async function reviewSubmission(submissionId: string, input: { status: ReviewStatus; note?: string | null; userId: string }) {
  if (!REVIEW_STATUSES.includes(input.status)) throw new ValidationError(`Invalid review status: ${input.status}`, { status: ["Invalid"] });
  const submission = await db.query.submissions.findFirst({ where: eq(submissions.id, submissionId) });
  if (!submission) throw new NotFoundError("Submission");
  const [row] = await db
    .update(submissions)
    .set({ status: input.status, reviewNote: input.note ?? submission.reviewNote, reviewedById: input.userId, reviewedAt: new Date() })
    .where(eq(submissions.id, submissionId))
    .returning();
  await recordDecision({
    editionId: submission.editionId,
    entityType: "SUBMISSION",
    entityId: submissionId,
    decision: `SUBMISSION_${input.status}`,
    reason: input.note ?? null,
    previousValue: { status: submission.status },
    newValue: { status: input.status },
    userId: input.userId,
  });
  return row;
}

export async function bulkReviewSubmissions(submissionIds: string[], input: { status: ReviewStatus; note?: string | null; userId: string }) {
  const ids = [...new Set(submissionIds)];
  if (!ids.length) return { updated: 0, ids: [] as string[] };
  const existing = await db.select({ id: submissions.id }).from(submissions).where(inArray(submissions.id, ids));
  const updated: string[] = [];
  for (const row of existing) {
    await reviewSubmission(row.id, input);
    updated.push(row.id);
  }
  return { updated: updated.length, ids: updated };
}

/** Submissions of an edition that were never processed by the AI pipeline. */
export async function listUnprocessedSubmissionIds(editionId: string): Promise<string[]> {
  const rows = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(eq(submissions.editionId, editionId), sql`${submissions.processedAt} is null`, sql`${submissions.status} <> 'DRAFT'`))
    .orderBy(submissions.createdAt);
  return rows.map((r) => r.id);
}
