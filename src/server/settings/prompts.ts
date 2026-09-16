/**
 * Prompt manager: versioned prompt templates (PROMPT_DEFAULTS ∪ prompt_templates rows).
 */
import { and, asc, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { aiJobs, promptTemplates, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { invalidatePromptCache, renderTemplate } from "@/server/ai/run";
import { getPromptDefault, PROMPT_DEFAULTS, type PromptDefault } from "@/server/ai/prompts";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { diffSummary, extractTemplateVariables, nextPromptVersion, sampleVariables, type PromptFields } from "./prompt-versioning";

export const CATEGORY_ORDER = ["ingestion", "organisation", "writing", "editing", "planning", "qa", "media", "general"];

export const CATEGORY_LABELS: Record<string, string> = {
  ingestion: "Ingestion",
  organisation: "Organisation",
  writing: "Writing",
  editing: "Editing",
  planning: "Planning",
  qa: "Quality assurance",
  media: "Media",
  general: "General",
};

export type PromptSummary = {
  key: string;
  name: string;
  category: string;
  description: string | null;
  activeVersion: number | null;
  versions: number;
  modelTier: "FAST" | "STRONG";
  temperature: number;
  maxOutputTokens: number;
  updatedAt: Date | null;
  isDefault: boolean;
  source: "db" | "default";
  usage: { calls: number; costCents: number; lastUsedAt: Date | null };
};

export async function listPrompts(): Promise<PromptSummary[]> {
  const rows = await db.select().from(promptTemplates).orderBy(asc(promptTemplates.key), desc(promptTemplates.version));
  const usageRows = await db
    .select({ key: aiJobs.promptKey, calls: sql<number>`count(*)`, costCents: sql<number>`coalesce(sum(${aiJobs.costCents}), 0)`, lastUsedAt: max(aiJobs.createdAt) })
    .from(aiJobs)
    .groupBy(aiJobs.promptKey);
  const usage = new Map(usageRows.map((u) => [u.key ?? "", { calls: Number(u.calls), costCents: Number(u.costCents), lastUsedAt: u.lastUsedAt ?? null }]));
  const byKey = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byKey.get(row.key) ?? [];
    list.push(row);
    byKey.set(row.key, list);
  }
  const keys = new Set<string>([...PROMPT_DEFAULTS.map((p) => p.key), ...byKey.keys()]);
  const out: PromptSummary[] = [];
  for (const key of keys) {
    const def = getPromptDefault(key) ?? null;
    const versions = byKey.get(key) ?? [];
    const active = versions.find((v) => v.isActive) ?? null;
    const latest = versions[0] ?? null;
    const base = active ?? latest;
    const isDefault = !active || (def !== null && active.systemPrompt === def.system && active.userPrompt === def.user && active.modelTier === def.tier && active.temperature === def.temperature && active.maxOutputTokens === def.maxOutputTokens);
    out.push({
      key,
      name: base?.name ?? def?.name ?? key,
      category: base?.category ?? def?.category ?? "general",
      description: base?.description ?? def?.description ?? null,
      activeVersion: active?.version ?? null,
      versions: versions.length,
      modelTier: active?.modelTier ?? def?.tier ?? "FAST",
      temperature: active?.temperature ?? def?.temperature ?? 0.2,
      maxOutputTokens: active?.maxOutputTokens ?? def?.maxOutputTokens ?? 2000,
      updatedAt: latest?.createdAt ?? null,
      isDefault,
      source: active ? "db" : "default",
      usage: usage.get(key) ?? { calls: 0, costCents: 0, lastUsedAt: null },
    });
  }
  return out.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
}

export type PromptVersionRow = {
  id: string;
  version: number;
  isActive: boolean;
  name: string;
  description: string | null;
  category: string;
  systemPrompt: string;
  userPrompt: string;
  modelTier: "FAST" | "STRONG";
  temperature: number;
  maxOutputTokens: number;
  createdAt: Date;
  createdBy: string | null;
  changeSummary: string;
};

export type PromptDetail = {
  key: string;
  name: string;
  category: string;
  description: string | null;
  default: PromptDefault | null;
  active: PromptVersionRow | null;
  versions: PromptVersionRow[];
  variables: string[];
  usage: { calls: number; costCents: number; failed: number; avgLatencyMs: number | null; lastUsedAt: Date | null };
};

export async function getPromptDetail(key: string): Promise<PromptDetail> {
  const def = getPromptDefault(key) ?? null;
  const rows = await db
    .select({ row: promptTemplates, createdBy: users.name })
    .from(promptTemplates)
    .leftJoin(users, eq(users.id, promptTemplates.createdById))
    .where(eq(promptTemplates.key, key))
    .orderBy(asc(promptTemplates.version));
  if (!def && !rows.length) throw new NotFoundError("Prompt");
  const versions: PromptVersionRow[] = rows.map(({ row, createdBy }, i) => {
    const prev = i > 0 ? rows[i - 1].row : null;
    return {
      id: row.id,
      version: row.version,
      isActive: row.isActive,
      name: row.name,
      description: row.description,
      category: row.category,
      systemPrompt: row.systemPrompt,
      userPrompt: row.userPrompt,
      modelTier: row.modelTier,
      temperature: row.temperature,
      maxOutputTokens: row.maxOutputTokens,
      createdAt: row.createdAt,
      createdBy,
      changeSummary: diffSummary(prev ? toFields(prev) : null, toFields(row)),
    };
  });
  versions.reverse();
  const active = versions.find((v) => v.isActive) ?? null;
  const [usage] = await db
    .select({ calls: sql<number>`count(*)`, costCents: sql<number>`coalesce(sum(${aiJobs.costCents}), 0)`, failed: sql<number>`count(*) filter (where ${aiJobs.status} = 'FAILED')`, avgLatencyMs: sql<number | null>`avg(${aiJobs.latencyMs}) filter (where ${aiJobs.cached} = false)`, lastUsedAt: max(aiJobs.createdAt) })
    .from(aiJobs)
    .where(eq(aiJobs.promptKey, key));
  const system = active?.systemPrompt ?? def?.system ?? "";
  const user = active?.userPrompt ?? def?.user ?? "";
  return {
    key,
    name: active?.name ?? versions[0]?.name ?? def?.name ?? key,
    category: active?.category ?? versions[0]?.category ?? def?.category ?? "general",
    description: active?.description ?? versions[0]?.description ?? def?.description ?? null,
    default: def,
    active,
    versions,
    variables: extractTemplateVariables(system, user),
    usage: { calls: Number(usage?.calls ?? 0), costCents: Number(usage?.costCents ?? 0), failed: Number(usage?.failed ?? 0), avgLatencyMs: usage?.avgLatencyMs == null ? null : Math.round(Number(usage.avgLatencyMs)), lastUsedAt: usage?.lastUsedAt ?? null },
  };
}

function toFields(row: { systemPrompt: string; userPrompt: string; modelTier: "FAST" | "STRONG"; temperature: number; maxOutputTokens: number }): PromptFields {
  return { systemPrompt: row.systemPrompt, userPrompt: row.userPrompt, modelTier: row.modelTier, temperature: row.temperature, maxOutputTokens: row.maxOutputTokens };
}

export const promptVersionInputSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(400).nullable().optional(),
  systemPrompt: z.string().min(1, "System prompt is required").max(20_000),
  userPrompt: z.string().min(1, "User prompt is required").max(20_000),
  modelTier: z.enum(["FAST", "STRONG"]),
  temperature: z.coerce.number().min(0).max(2),
  maxOutputTokens: z.coerce.number().int().min(50).max(32_000),
});
export type PromptVersionInput = z.input<typeof promptVersionInputSchema>;

/** Inserts version max+1 and makes it the only active version, then clears the prompt cache. */
export async function savePromptVersion(key: string, raw: PromptVersionInput, userId?: string | null) {
  const input = promptVersionInputSchema.parse(raw);
  const def = getPromptDefault(key);
  const row = await db.transaction(async (tx) => {
    const existing = await tx.select({ version: promptTemplates.version, name: promptTemplates.name, description: promptTemplates.description, category: promptTemplates.category }).from(promptTemplates).where(eq(promptTemplates.key, key)).orderBy(desc(promptTemplates.version));
    if (!existing.length && !def) throw new ValidationError(`Unknown prompt key "${key}"`);
    const version = nextPromptVersion(existing.map((e) => e.version));
    await tx.update(promptTemplates).set({ isActive: false }).where(eq(promptTemplates.key, key));
    const [inserted] = await tx
      .insert(promptTemplates)
      .values({
        key,
        version,
        name: input.name ?? existing[0]?.name ?? def?.name ?? key,
        description: input.description === undefined ? (existing[0]?.description ?? def?.description ?? null) : input.description,
        category: existing[0]?.category ?? def?.category ?? "general",
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        modelTier: input.modelTier,
        temperature: input.temperature,
        maxOutputTokens: input.maxOutputTokens,
        isActive: true,
        createdById: userId ?? null,
      })
      .returning();
    return inserted;
  });
  invalidatePromptCache();
  await audit({ action: "prompt.version.create", userId, entityType: "PROMPT_TEMPLATE", entityId: row.id, metadata: { key, version: row.version, modelTier: row.modelTier } });
  return row;
}

export async function activatePromptVersion(key: string, version: number, userId?: string | null) {
  const target = await db.query.promptTemplates.findFirst({ where: and(eq(promptTemplates.key, key), eq(promptTemplates.version, version)) });
  if (!target) throw new NotFoundError(`Version ${version} of ${key}`);
  await db.transaction(async (tx) => {
    await tx.update(promptTemplates).set({ isActive: false }).where(eq(promptTemplates.key, key));
    await tx.update(promptTemplates).set({ isActive: true }).where(eq(promptTemplates.id, target.id));
  });
  invalidatePromptCache();
  await audit({ action: "prompt.version.activate", userId, entityType: "PROMPT_TEMPLATE", entityId: target.id, metadata: { key, version } });
  return target;
}

/** Saves the shipped default as a new active version (history is kept). */
export async function restorePromptDefault(key: string, userId?: string | null) {
  const def = getPromptDefault(key);
  if (!def) throw new NotFoundError("Default prompt");
  const row = await savePromptVersion(key, { name: def.name, description: def.description, systemPrompt: def.system, userPrompt: def.user, modelTier: def.tier, temperature: def.temperature, maxOutputTokens: def.maxOutputTokens }, userId);
  await audit({ action: "prompt.restore_default", userId, entityType: "PROMPT_TEMPLATE", entityId: row.id, metadata: { key, version: row.version } });
  return row;
}

export const promptTestSchema = z.object({
  systemPrompt: z.string().max(20_000),
  userPrompt: z.string().max(20_000),
  variables: z.record(z.string(), z.string().max(4000)).default({}),
});

/** Renders a template with sample (or provided) variables. No model call. */
export function renderPromptTest(raw: z.input<typeof promptTestSchema>) {
  const input = promptTestSchema.parse(raw);
  const names = extractTemplateVariables(input.systemPrompt, input.userPrompt);
  const vars = { ...sampleVariables(names), ...input.variables };
  return {
    variables: names.map((name) => ({ name, value: vars[name] ?? "" })),
    system: renderTemplate(input.systemPrompt, vars),
    user: renderTemplate(input.userPrompt, vars),
  };
}
