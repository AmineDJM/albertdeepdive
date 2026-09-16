import type { StoryTypeValue } from "@/lib/constants";
import type { DraftDTO, InvitationDTO } from "@/lib/submissions/dto";
import type { DraftPatch } from "@/lib/submissions/schemas";

/** Everything the form edits; mirrors the draft columns. */
export type FormValues = {
  storyType: StoryTypeValue | null;
  title: string;
  campusIds: string[];
  eventDateText: string;
  description: string;
  peopleInvolved: string;
  organisationsInvolved: string;
  whyItMatters: string;
  quotes: string;
  urls: string[];
  contactName: string;
  contactEmail: string;
  extra: Record<string, unknown>;
  publicationConsent: boolean;
  imageRightsConfirmed: boolean;
};

export const FORM_KEYS = [
  "storyType",
  "title",
  "campusIds",
  "eventDateText",
  "description",
  "peopleInvolved",
  "organisationsInvolved",
  "whyItMatters",
  "quotes",
  "urls",
  "contactName",
  "contactEmail",
  "extra",
  "publicationConsent",
  "imageRightsConfirmed",
] as const satisfies readonly (keyof FormValues)[];

export function valuesFromDraft(draft: DraftDTO | null, invitation: InvitationDTO): FormValues {
  const started = !!draft && (draft.title.trim() !== "" || draft.description.trim() !== "" || Object.keys(draft.extra ?? {}).length > 0);
  return {
    storyType: draft && started ? draft.storyType : null,
    title: draft?.title ?? "",
    campusIds: draft?.campusIds ?? (invitation.contributor.campusId ? [invitation.contributor.campusId] : []),
    eventDateText: draft?.eventDateText ?? "",
    description: draft?.description ?? "",
    peopleInvolved: draft?.peopleInvolved ?? "",
    organisationsInvolved: draft?.organisationsInvolved ?? "",
    whyItMatters: draft?.whyItMatters ?? "",
    quotes: draft?.quotes ?? "",
    urls: draft?.urls ?? [],
    contactName: draft?.contactName ?? `${invitation.contributor.firstName} ${invitation.contributor.lastName}`.trim(),
    contactEmail: draft?.contactEmail ?? invitation.contributor.email,
    extra: draft?.extra ?? {},
    publicationConsent: draft?.publicationConsent ?? false,
    imageRightsConfirmed: draft?.imageRightsConfirmed ?? false,
  };
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Keys of `next` that differ from `prev`, shaped as an autosave patch. */
export function diffValues(prev: FormValues, next: FormValues): DraftPatch {
  const patch: DraftPatch = {};
  for (const key of FORM_KEYS) {
    if (same(prev[key], next[key])) continue;
    if (key === "storyType") {
      if (next.storyType) patch.storyType = next.storyType;
      continue;
    }
    if (key === "urls") {
      patch.urls = next.urls.map((u) => u.trim()).filter(Boolean);
      continue;
    }
    (patch as Record<string, unknown>)[key] = next[key];
  }
  return patch;
}

/** Payload sent at submit time (validated by the shared schema on both sides). */
export function payloadFromValues(values: FormValues) {
  return {
    ...values,
    storyType: values.storyType ?? "OTHER",
    urls: values.urls.map((u) => u.trim()).filter(Boolean),
  };
}

export type Step = 0 | 1 | 2 | 3;

export const STEPS: { key: Step; label: string; short: string }[] = [
  { key: 0, label: "What happened?", short: "Type" },
  { key: 1, label: "Tell us more", short: "Details" },
  { key: 2, label: "Photos & files", short: "Files" },
  { key: 3, label: "Review & send", short: "Send" },
];

/** Which step a validation error belongs to, so the form can jump there. */
export function stepForError(key: string): Step {
  if (key === "storyType") return 0;
  if (key === "publicationConsent" || key === "imageRightsConfirmed") return 3;
  return 1;
}

export const DETAILS_ONLY_ERRORS = (errors: Record<string, string[]>) => Object.fromEntries(Object.entries(errors).filter(([k]) => stepForError(k) === 1));
