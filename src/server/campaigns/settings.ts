import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { systemSettings } from "@/server/db/schema";
import { DEFAULT_SECTIONS } from "@/lib/constants";
import { DEFAULT_CAMPAIGN_DEFAULTS, type CampaignDefaults } from "@/lib/campaigns/schedule";
import { AUTOMATION_KEYS, DEFAULT_AUTOMATION_TOGGLES, type AutomationKey, type AutomationToggles } from "@/lib/campaigns/automations";

/** Reads one system setting, falling back to `fallback` when missing or malformed. */
export async function getSetting<T>(key: string, fallback: T, schema?: z.ZodType<T>): Promise<T> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, key) });
  if (!row) return fallback;
  if (!schema) return (row.value as T) ?? fallback;
  const parsed = schema.safeParse(row.value);
  return parsed.success ? parsed.data : fallback;
}

const campaignDefaultsSchema = z.object({
  openDay: z.coerce.number().int().min(1).max(31),
  openHour: z.coerce.number().int().min(0).max(23),
  reminder1Day: z.coerce.number().int().min(1).max(31),
  reminder2Day: z.coerce.number().int().min(1).max(31),
  graceDay: z.coerce.number().int().min(1).max(31),
  publicationDay: z.coerce.number().int().min(1).max(31),
  finalReviewDay: z.coerce.number().int().min(1).max(31),
});

export async function getCampaignDefaults(): Promise<CampaignDefaults> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, "campaign_defaults") });
  const parsed = campaignDefaultsSchema.partial().safeParse(row?.value ?? {});
  return { ...DEFAULT_CAMPAIGN_DEFAULTS, ...(parsed.success ? parsed.data : {}) };
}

export async function getAutomationToggles(): Promise<AutomationToggles> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, "automations") });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_AUTOMATION_TOGGLES };
  for (const key of AUTOMATION_KEYS) if (typeof value[key] === "boolean") out[key] = value[key] as boolean;
  return out;
}

const contactSchema = z.object({ email: z.string().optional(), website: z.string().optional(), instagram: z.string().optional() });

export async function getContactSettings() {
  const value = await getSetting("contact", {} as z.infer<typeof contactSchema>, contactSchema);
  return { email: value.email ?? null, website: value.website ?? null, instagram: value.instagram ?? null };
}

const sectionSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  kicker: z.string().nullable().optional(),
  colour: z.string().nullable().optional(),
  targetPages: z.number().int().nullable().optional(),
});

export type DefaultSection = z.infer<typeof sectionSchema>;

export async function getDefaultSections(): Promise<DefaultSection[]> {
  const row = await db.query.systemSettings.findFirst({ where: eq(systemSettings.key, "default_sections") });
  const parsed = z.array(sectionSchema).safeParse(row?.value);
  if (parsed.success && parsed.data.length) return parsed.data;
  return DEFAULT_SECTIONS.map((s) => ({ slug: s.slug, name: s.name, kicker: s.kicker, colour: s.colour, targetPages: s.targetPages }));
}

export { AUTOMATION_KEYS, DEFAULT_AUTOMATION_TOGGLES, type AutomationKey, type AutomationToggles };
