/**
 * System settings service: typed read/write of the `system_settings` key/value store.
 */
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { systemSettings, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { env } from "@/server/env";
import { ValidationError } from "@/lib/action-result";
import { AUTOMATION_KEYS, DEFAULT_AUTOMATION_TOGGLES, type AutomationKey, type AutomationToggles } from "@/server/campaigns/settings";
import {
  aiSettingsSchema,
  campaignDefaultsSchema,
  contactSchema,
  DEFAULT_CAMPAIGN_DEFAULTS,
  DEFAULT_CONTACT,
  DEFAULT_MASTHEAD,
  DEFAULT_PRINT,
  DEFAULT_PRIVACY,
  defaultSectionsSchema,
  defaultSectionsTemplate,
  mastheadSchema,
  printSchema,
  privacySchema,
  SETTING_DESCRIPTIONS,
  SETTING_KEYS,
  SETTING_SCHEMAS,
  type AiSettings,
  type ContactSettings,
  type DefaultSectionInput,
  type MastheadSettings,
  type PrintSettings,
  type PrivacySettings,
  type SettingKey,
} from "./schemas";
import type { CampaignDefaults } from "@/lib/campaigns/schedule";

export type SettingRow = { key: string; value: unknown; description: string | null; updatedAt: Date; updatedBy: string | null };

export async function listSettingRows(): Promise<SettingRow[]> {
  const rows = await db
    .select({ key: systemSettings.key, value: systemSettings.value, description: systemSettings.description, updatedAt: systemSettings.updatedAt, updatedBy: users.name })
    .from(systemSettings)
    .leftJoin(users, eq(users.id, systemSettings.updatedById));
  return rows;
}

function parseOr<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }, value: unknown, fallback: T): T {
  const parsed = schema.safeParse(value);
  return parsed.success && parsed.data !== undefined ? parsed.data : fallback;
}

export type SystemSettingsView = {
  masthead: MastheadSettings;
  contact: ContactSettings;
  campaignDefaults: CampaignDefaults;
  print: PrintSettings;
  ai: AiSettings;
  automations: AutomationToggles;
  privacy: PrivacySettings;
  defaultSections: DefaultSectionInput[];
  meta: Partial<Record<SettingKey, { updatedAt: Date; updatedBy: string | null }>>;
};

/** Every setting, parsed and merged with its defaults (malformed rows fall back to defaults). */
export async function getSystemSettings(): Promise<SystemSettingsView> {
  const rows = await listSettingRows();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const value = (key: SettingKey) => byKey.get(key)?.value;
  const storedAutomations = (value("automations") ?? {}) as Record<string, unknown>;
  const automations = { ...DEFAULT_AUTOMATION_TOGGLES };
  for (const k of AUTOMATION_KEYS) if (typeof storedAutomations[k] === "boolean") automations[k] = storedAutomations[k] as boolean;
  const meta: SystemSettingsView["meta"] = {};
  for (const key of SETTING_KEYS) {
    const row = byKey.get(key);
    if (row) meta[key] = { updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }
  const campaignDefaults = campaignDefaultsSchema.safeParse({ ...DEFAULT_CAMPAIGN_DEFAULTS, ...((value("campaign_defaults") as object) ?? {}) });
  const sections = defaultSectionsSchema.safeParse(value("default_sections"));
  return {
    masthead: parseOr(mastheadSchema, value("masthead"), DEFAULT_MASTHEAD),
    contact: parseOr(contactSchema, value("contact"), DEFAULT_CONTACT),
    campaignDefaults: campaignDefaults.success ? campaignDefaults.data : DEFAULT_CAMPAIGN_DEFAULTS,
    print: parseOr(printSchema, value("print"), DEFAULT_PRINT),
    ai: parseOr(aiSettingsSchema, value("ai"), { monthlyBudgetEur: env.AI_MAX_MONTHLY_BUDGET_EUR, provider: env.AI_PROVIDER }),
    automations,
    privacy: parseOr(privacySchema, value("privacy"), DEFAULT_PRIVACY),
    defaultSections: sections.success ? sections.data : defaultSectionsTemplate(),
    meta,
  };
}

/** Validates and upserts one setting. Returns the parsed value. */
export async function saveSetting<T = unknown>(key: SettingKey, rawValue: unknown, userId?: string | null): Promise<T> {
  const schema = SETTING_SCHEMAS[key];
  if (!schema) throw new ValidationError(`Unknown setting "${key}"`);
  const parsed = schema.safeParse(rawValue);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path.length ? issue.path.join(".") : key;
      (fieldErrors[path] ??= []).push(issue.message);
    }
    const first = parsed.error.issues[0];
    throw new ValidationError(first ? `${first.path.join(".") || key}: ${first.message}` : "Invalid value", fieldErrors);
  }
  const value = parsed.data as T;
  await db
    .insert(systemSettings)
    .values({ key, value, description: SETTING_DESCRIPTIONS[key], updatedById: userId ?? null })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, updatedById: userId ?? null, updatedAt: new Date() } });
  await audit({ action: "settings.update", userId, entityType: "SETTING", metadata: { key, fields: value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value as object) : undefined, items: Array.isArray(value) ? value.length : undefined } });
  return value;
}

export async function setAutomationToggle(key: AutomationKey, enabled: boolean, userId?: string | null): Promise<AutomationToggles> {
  if (!AUTOMATION_KEYS.includes(key)) throw new ValidationError(`Unknown automation "${key}"`);
  const current = (await getSystemSettings()).automations;
  const next = { ...current, [key]: enabled };
  await db
    .insert(systemSettings)
    .values({ key: "automations", value: next, description: SETTING_DESCRIPTIONS.automations, updatedById: userId ?? null })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value: next, updatedById: userId ?? null, updatedAt: new Date() } });
  await audit({ action: "automation.toggle", userId, entityType: "SETTING", metadata: { automation: key, enabled } });
  return next;
}

export async function resetDefaultSections(userId?: string | null) {
  return saveSetting<DefaultSectionInput[]>("default_sections", defaultSectionsTemplate(), userId);
}
