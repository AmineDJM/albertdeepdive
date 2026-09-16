/**
 * Shared validation for the public contribution form.
 *
 * The same schemas drive the server (submit / autosave) and the client (field metadata,
 * inline validation), so the form and the API can never drift apart.
 */
import { z } from "zod";
import { STORY_TYPES, type StoryTypeValue } from "@/lib/constants";

export const STORY_TYPE_VALUES = STORY_TYPES.map((t) => t.value) as unknown as [StoryTypeValue, ...StoryTypeValue[]];
export const storyTypeSchema = z.enum(STORY_TYPE_VALUES);

export type ExtraFieldKind = "text" | "textarea" | "url" | "urls" | "date";

export type ExtraFieldSpec = {
  key: string;
  label: string;
  kind: ExtraFieldKind;
  required?: boolean;
  placeholder?: string;
  help?: string;
  maxLength?: number;
};

/** Type-specific questions, in the order they are shown on the form. */
export const EXTRA_FIELDS: Record<StoryTypeValue, ExtraFieldSpec[]> = {
  BUSINESS_DEEP_DIVE: [
    { key: "company", label: "Company", kind: "text", required: true, placeholder: "e.g. Carrefour" },
    { key: "cohort", label: "Cohort & campus", kind: "text", placeholder: "e.g. B2 Paris" },
    { key: "projectDates", label: "Project dates", kind: "text", placeholder: "e.g. from 17 March to 4 April" },
    { key: "businessProblem", label: "The business problem", kind: "textarea", placeholder: "What did the company ask you to solve?" },
    { key: "dataset", label: "The data", kind: "textarea", placeholder: "What data did you work with? Size, sources, quirks." },
    { key: "methodology", label: "Methodology", kind: "textarea", placeholder: "How did you approach it, step by step?" },
    { key: "technologies", label: "Technologies & models", kind: "text", placeholder: "e.g. LightGBM, Streamlit, Power BI" },
    { key: "finalRecommendation", label: "Final recommendation", kind: "textarea", placeholder: "What did you recommend to the company?" },
    { key: "measurableResults", label: "Measurable results", kind: "textarea", placeholder: "Numbers, metrics, impact." },
    { key: "winningTeam", label: "Winning team", kind: "textarea", required: true, placeholder: "Full names, one per line", help: "People are always named in full in the paper." },
    { key: "finalists", label: "Finalists", kind: "textarea", placeholder: "Other teams that made it to the final" },
    { key: "jury", label: "Jury", kind: "textarea", placeholder: "Names and roles of the jury members" },
    { key: "lessonsLearned", label: "Lessons learned", kind: "textarea", placeholder: "What would you tell next year's cohort?" },
  ],
  UPCOMING_EVENT: [
    { key: "eventDate", label: "Event date", kind: "date", required: true, placeholder: "e.g. Friday 4 April, 19:00" },
    { key: "location", label: "Location", kind: "text", placeholder: "Campus, address or online" },
    { key: "signupUrl", label: "Sign-up link", kind: "url", placeholder: "https://" },
    { key: "organiser", label: "Organiser", kind: "text", placeholder: "Association, team or person" },
  ],
  EVENT_RECAP: [
    { key: "location", label: "Location", kind: "text" },
    { key: "organiser", label: "Organiser", kind: "text" },
    { key: "attendance", label: "Attendance", kind: "text", placeholder: "e.g. about 120 students" },
  ],
  INTERVIEW_PROFILE: [
    { key: "intervieweeName", label: "Who is it about?", kind: "text", required: true, placeholder: "Full name" },
    { key: "intervieweeRole", label: "Their role", kind: "text", placeholder: "e.g. B3 student, Head of admissions" },
  ],
  ASSOCIATION: [
    { key: "associationName", label: "Association", kind: "text", required: true },
    { key: "contactChannel", label: "How to reach the association", kind: "text", placeholder: "Instagram, email, WhatsApp…" },
  ],
  STUDENT_PROJECT: [
    { key: "projectName", label: "Project or company name", kind: "text", required: true },
    { key: "website", label: "Website", kind: "url", placeholder: "https://" },
    { key: "stage", label: "Stage", kind: "text", placeholder: "Idea, launched, first clients…" },
  ],
  STUDENT_ACHIEVEMENT: [
    { key: "achievement", label: "The achievement", kind: "text", required: true, placeholder: "e.g. admitted to X-HEC, won the regatta" },
    { key: "awardedBy", label: "Awarded by", kind: "text", placeholder: "School, jury, competition" },
  ],
  DATA_AI_BUSINESS_INSIGHT: [
    { key: "sourceUrls", label: "Sources", kind: "urls", required: true, help: "At least one link to the original article or report." },
  ],
  SCHOOL_NEWS: [],
  CAMPUS_LIFE: [],
  ALUMNI: [],
  ACADEMIC_NEWS: [],
  CAREER_INTERNSHIP: [],
  PHOTO_STORY: [],
  ANECDOTE: [],
  OTHER: [],
};

export const DESCRIPTION_MIN_CHARS = 20;
export const TITLE_MIN_CHARS = 3;
export const MAX_URLS = 20;

/** Accepts "albertschool.com" as well as full URLs; returns a normalised absolute URL. */
export function normaliseUrl(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export const urlSchema = z.preprocess(normaliseUrl, z.url({ error: "Enter a valid link (https://…)" }).max(500));

const urlList = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()) : v),
  z.array(urlSchema).max(MAX_URLS, `At most ${MAX_URLS} links`),
);

const text = (max: number) => z.string().trim().max(max, `At most ${max} characters`).default("");

const blankToEmpty = (v: unknown) => (v == null ? "" : v);
const requiredText = (max: number, message: string) => z.preprocess(blankToEmpty, z.string().trim().min(1, message).max(max, `At most ${max} characters`));

function extraFieldSchema(spec: ExtraFieldSpec) {
  const requiredMessage = `${spec.label} is required`;
  switch (spec.kind) {
    case "url": {
      const base = z.preprocess(normaliseUrl, z.url({ error: "Enter a valid link (https://…)" }).max(500));
      return spec.required ? z.preprocess(blankToEmpty, base) : z.preprocess((v) => (v === "" || v == null ? undefined : v), base.optional());
    }
    case "urls":
      return spec.required
        ? z.preprocess((v) => (v == null ? [] : v), urlList.pipe(z.array(z.string()).min(1, requiredMessage)))
        : urlList.optional();
    case "textarea":
      return spec.required ? requiredText(spec.maxLength ?? 8000, requiredMessage) : text(spec.maxLength ?? 8000);
    case "date":
    case "text":
    default:
      return spec.required ? requiredText(spec.maxLength ?? 500, requiredMessage) : text(spec.maxLength ?? 500);
  }
}

/** Strict schema of the type-specific fields (unknown keys are dropped). */
export function extraSchemaFor(storyType: StoryTypeValue) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const spec of EXTRA_FIELDS[storyType] ?? []) shape[spec.key] = extraFieldSchema(spec);
  return z.object(shape);
}

export const submissionBaseSchema = z.object({
  storyType: storyTypeSchema,
  title: z.string().trim().min(TITLE_MIN_CHARS, `Give your story a title (at least ${TITLE_MIN_CHARS} characters)`).max(200, "Keep the title under 200 characters"),
  /** Empty = the whole school. */
  campusIds: z.array(z.uuid()).max(20).default([]),
  eventDateText: text(160),
  description: z.string().trim().min(DESCRIPTION_MIN_CHARS, `Tell us a little more — at least ${DESCRIPTION_MIN_CHARS} characters`).max(20000, "That is a bit long — 20,000 characters max"),
  peopleInvolved: text(2000),
  organisationsInvolved: text(2000),
  whyItMatters: text(4000),
  quotes: text(4000),
  urls: urlList.default([]),
  contactName: text(160),
  contactEmail: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), z.union([z.literal(""), z.email({ error: "Enter a valid email address" })]).default("")),
  publicationConsent: z.boolean().default(false),
  imageRightsConfirmed: z.boolean().default(false),
  extra: z.record(z.string(), z.unknown()).default({}),
});

export type SubmissionPayloadInput = z.input<typeof submissionBaseSchema>;
export type SubmissionPayload = z.output<typeof submissionBaseSchema>;

export type ValidationOutcome =
  | { ok: true; data: SubmissionPayload }
  | { ok: false; error: string; fieldErrors: Record<string, string[]> };

export function fieldErrorsFromIssues(issues: readonly { path: PropertyKey[]; message: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issue.path.length ? issue.path.map(String).join(".") : "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

/**
 * Full validation used at submit time. `hasPhotos` makes the image-rights confirmation
 * mandatory; the type-specific `extra` object is validated with the story type's schema.
 */
export function validateSubmissionPayload(input: unknown, opts: { hasPhotos: boolean }): ValidationOutcome {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const base = submissionBaseSchema.safeParse(raw);
  const issues: { path: PropertyKey[]; message: string }[] = base.success ? [] : [...base.error.issues];
  let data: SubmissionPayload | null = base.success ? base.data : null;

  // Consent and type-specific checks run even when the base fields are invalid, so the
  // contributor sees every problem at once instead of one at a time.
  if (raw.publicationConsent !== true) issues.push({ path: ["publicationConsent"], message: "Please confirm that this story may be published" });
  if (opts.hasPhotos && raw.imageRightsConfirmed !== true) issues.push({ path: ["imageRightsConfirmed"], message: "Please confirm the image rights for the photos you attached" });
  const storyType = storyTypeSchema.safeParse(raw.storyType);
  if (storyType.success) {
    const extra = extraSchemaFor(storyType.data).safeParse(raw.extra && typeof raw.extra === "object" ? raw.extra : {});
    if (extra.success) {
      if (data) data = { ...data, extra: extra.data };
    } else issues.push(...extra.error.issues.map((i) => ({ path: ["extra", ...i.path], message: i.message })));
  }

  if (issues.length || !data) {
    const fieldErrors = fieldErrorsFromIssues(issues);
    const count = Object.keys(fieldErrors).length;
    return { ok: false, error: count === 1 ? "One field needs your attention" : `${count} fields need your attention`, fieldErrors };
  }
  return { ok: true, data };
}

/** Lenient autosave patch: every field optional, no minimum lengths, unknown keys dropped. */
export const draftPatchSchema = z
  .object({
    storyType: storyTypeSchema,
    title: z.string().max(200),
    campusIds: z.array(z.uuid()).max(20),
    eventDateText: z.string().max(160),
    description: z.string().max(20000),
    peopleInvolved: z.string().max(2000),
    organisationsInvolved: z.string().max(2000),
    whyItMatters: z.string().max(4000),
    quotes: z.string().max(4000),
    urls: z.array(z.string().max(500)).max(MAX_URLS),
    contactName: z.string().max(160),
    contactEmail: z.string().max(200),
    publicationConsent: z.boolean(),
    imageRightsConfirmed: z.boolean(),
    extra: z.record(z.string(), z.unknown()),
  })
  .partial();

export type DraftPatch = z.infer<typeof draftPatchSchema>;

export const attachmentMetaSchema = z.object({
  caption: z.string().trim().max(500).optional(),
  photographer: z.string().trim().max(160).optional(),
});

export const declineSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  undo: z.boolean().optional(),
});

export function storyTypeHasExtraFields(storyType: StoryTypeValue) {
  return (EXTRA_FIELDS[storyType] ?? []).length > 0;
}
