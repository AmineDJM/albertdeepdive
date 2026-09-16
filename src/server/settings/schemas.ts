/**
 * System settings — keys, zod schemas and pure validators.
 *
 * `system_settings` is a generic key/value store; this module is the single place that says what
 * each key is allowed to contain. Everything here is pure (no database) so forms and unit tests can
 * reuse the same rules.
 */
import { z } from "zod";
import { AUTOMATION_KEYS, type AutomationKey } from "@/server/campaigns/settings";
import { DEFAULT_CAMPAIGN_DEFAULTS, type CampaignDefaults } from "@/lib/campaigns/schedule";
import { CONSENT_TEXT_VERSION, DEFAULT_SECTIONS } from "@/lib/constants";

export const SETTING_KEYS = [
  "masthead",
  "contact",
  "campaign_defaults",
  "default_sections",
  "print",
  "privacy",
  "ai",
  "automations",
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const mastheadSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(80),
  tagline: z.string().trim().max(160).default(""),
});
export type MastheadSettings = z.infer<typeof mastheadSchema>;
export const DEFAULT_MASTHEAD: MastheadSettings = {
  title: "Albert's Deep Dive",
  tagline: "The monthly newspaper of Albert School",
};

export const contactSchema = z.object({
  email: z.union([z.string().trim().email("Enter a valid email"), z.literal("")]).default(""),
  website: z.string().trim().max(200).default(""),
  instagram: z
    .string()
    .trim()
    .max(80)
    .transform((v) => v.replace(/^@/, ""))
    .default(""),
});
export type ContactSettings = z.infer<typeof contactSchema>;
export const DEFAULT_CONTACT: ContactSettings = { email: "", website: "", instagram: "" };

const dayOfMonth = z.coerce.number().int().min(1).max(28);

/** Ordering rules of the monthly schedule, returned as field errors (pure, reusable on the client). */
export function campaignDefaultsIssues(v: Partial<CampaignDefaults>): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const add = (field: string, message: string) => {
    (errors[field] ??= []).push(message);
  };
  const { openDay, reminder1Day, reminder2Day, graceDay, finalReviewDay, publicationDay } = v;
  if (openDay != null && reminder1Day != null && !(openDay < reminder1Day)) {
    add("reminder1Day", "Reminder #1 must come after the opening day");
  }
  if (reminder1Day != null && reminder2Day != null && !(reminder1Day < reminder2Day)) {
    add("reminder2Day", "Reminder #2 must come after reminder #1");
  }
  if (reminder2Day != null && graceDay != null && !(reminder2Day < graceDay)) {
    add("graceDay", "The grace period must end after reminder #2");
  }
  if (graceDay != null && finalReviewDay != null && !(graceDay < finalReviewDay)) {
    add("finalReviewDay", "The final review must come after the grace period");
  }
  if (finalReviewDay != null && publicationDay != null && !(finalReviewDay <= publicationDay)) {
    add("publicationDay", "Publication cannot be before the final review");
  }
  return errors;
}

export const campaignDefaultsSchema = z
  .object({
    openDay: dayOfMonth,
    openHour: z.coerce.number().int().min(0).max(23),
    reminder1Day: dayOfMonth,
    reminder2Day: dayOfMonth,
    graceDay: dayOfMonth,
    publicationDay: dayOfMonth,
    finalReviewDay: dayOfMonth,
  })
  .superRefine((v, ctx) => {
    for (const [field, messages] of Object.entries(campaignDefaultsIssues(v))) {
      for (const message of messages) ctx.addIssue({ code: "custom", path: [field], message });
    }
  });
export { DEFAULT_CAMPAIGN_DEFAULTS };

export const printSchema = z.object({
  pageSize: z.enum(["A4", "TABLOID", "LETTER"]),
  targetPageCount: z.coerce.number().int().min(4).max(96),
  mastheadFont: z.string().trim().max(60).optional(),
});
export type PrintSettings = z.infer<typeof printSchema>;
export const DEFAULT_PRINT: PrintSettings = { pageSize: "A4", targetPageCount: 24, mastheadFont: "Fraunces" };

export const aiSettingsSchema = z.object({
  monthlyBudgetEur: z.coerce.number().min(0).max(100_000),
  /** Informational copy of the provider at save time; the live value always comes from the environment. */
  provider: z.string().optional(),
});
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export const automationsSchema = z.object(
  Object.fromEntries(AUTOMATION_KEYS.map((k) => [k, z.boolean()])) as Record<AutomationKey, z.ZodBoolean>,
);
export type AutomationsSettings = z.infer<typeof automationsSchema>;

export const privacySchema = z.object({
  retentionDays: z.coerce.number().int().min(30, "Keep data at least 30 days").max(3650, "Ten years at most"),
  consentTextVersion: z.string().optional(),
});
export type PrivacySettings = z.infer<typeof privacySchema>;
export const DEFAULT_PRIVACY: PrivacySettings = { retentionDays: 730, consentTextVersion: CONSENT_TEXT_VERSION };

export const defaultSectionSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, "Slug is required")
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, digits and dashes only"),
  name: z.string().trim().min(1, "Name is required").max(80),
  kicker: z.string().trim().max(80).nullable().default(null),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour").nullable().default(null),
  targetPages: z.coerce.number().int().min(0).max(40).nullable().default(null),
  isHidden: z.boolean().default(false),
  storyTypes: z.array(z.string()).default([]),
});
export type DefaultSectionInput = z.infer<typeof defaultSectionSchema>;

export const defaultSectionsSchema = z
  .array(defaultSectionSchema)
  .min(1, "Keep at least one section")
  .superRefine((sections, ctx) => {
    const seen = new Set<string>();
    sections.forEach((s, i) => {
      if (seen.has(s.slug)) ctx.addIssue({ code: "custom", path: [i, "slug"], message: `Duplicate slug "${s.slug}"` });
      seen.add(s.slug);
    });
  });

export function defaultSectionsTemplate(): DefaultSectionInput[] {
  return DEFAULT_SECTIONS.map((s) => ({
    slug: s.slug,
    name: s.name,
    kicker: s.kicker,
    colour: s.colour,
    targetPages: s.targetPages,
    isHidden: false,
    storyTypes: [...s.storyTypes],
  }));
}

export const SETTING_SCHEMAS: Record<SettingKey, z.ZodTypeAny> = {
  masthead: mastheadSchema,
  contact: contactSchema,
  campaign_defaults: campaignDefaultsSchema,
  default_sections: defaultSectionsSchema,
  print: printSchema,
  privacy: privacySchema,
  ai: aiSettingsSchema,
  automations: automationsSchema,
};

export const SETTING_DESCRIPTIONS: Record<SettingKey, string> = {
  masthead: "Publication masthead",
  contact: "Contact details printed in the colophon",
  campaign_defaults: "Default monthly schedule (day of month)",
  default_sections: "Section template copied into every new edition",
  print: "Print defaults",
  privacy: "Data retention and consent",
  ai: "AI budget and routing",
  automations: "Automation toggles",
};
