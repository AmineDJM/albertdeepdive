import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { getStorage } from "@/server/storage";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES } from "@/server/jobs/registry";
import { kickJobRunner } from "@/server/jobs/runner";
import { hasFeature, requireFeature, resolveEntitlements } from "@/server/billing/entitlements";
import { guardTenant, scoped } from "@/server/tenancy/scope";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";
import { LanguageUnknownError, LANGUAGE_NAMES, resolveNarrationLanguage, type SpeechLanguage } from "@/lib/speech/language";
import { estimateSeconds } from "@/lib/speech/timing";
import { passagesFrom, scriptTotals } from "@/lib/speech/script";
import { ACCENTS, NARRATION_CONTEXTS, NARRATION_KINDS, PACES, STYLES, type NarrationKind } from "@/lib/speech/types";
import { resolveCatalogue, type VoiceCatalogue } from "@/lib/speech/voices";
import { resolveVoiceFor } from "./catalog";
import { getSpeechProvider, speechAvailability, speechConfig } from "./providers";
import { blocksText, framedBlocks, loadSource } from "./sources";
import { assertNarrationAllowance, narrationAllowance } from "./usage";

const log = createLogger("speech");

export type NarrationRow = typeof s.narrations.$inferSelect;
export type NarrationSegmentRow = typeof s.narrationSegments.$inferSelect;
export type BrandVoiceRow = typeof s.brandVoices.$inferSelect;

/** What a person may ask for. Anything outside these lists is refused before it costs anything. */
export const narrationOptionsSchema = z.object({
  voice: z.string().regex(/^(auto|female|male|brand|clone:[0-9a-f-]{36})$/),
  language: z.string().regex(/^(auto|[a-z]{2})$/),
  accent: z.enum(ACCENTS).default("auto"),
  style: z.enum(STYLES).default("editorial"),
  pace: z.enum(PACES).default("natural"),
  takes: z.union([z.literal(1), z.literal(2)]).default(1),
  speakers: z.enum(["auto", "single"]).default("auto"),
  context: z.enum(NARRATION_CONTEXTS).optional(),
});

export const createNarrationSchema = z.object({
  kind: z.enum(NARRATION_KINDS),
  editionId: z.string().uuid().nullable().optional(),
  articleId: z.string().uuid().nullable().optional(),
  packId: z.string().uuid().nullable().optional(),
  customText: z.string().max(60_000).nullable().optional(),
  quality: z.enum(["PREVIEW", "FINAL"]).default("PREVIEW"),
  options: narrationOptionsSchema,
});

export type CreateNarrationInput = z.infer<typeof createNarrationSchema> & { organizationId: string; actorId?: string | null; locale?: "en" | "fr" };

const EDITION_KINDS: NarrationKind[] = ["EDITION", "SUMMARY", "EXECUTIVE"];

/** The workspace's house voice, or nothing yet. */
export async function getBrandVoice(organizationId: string): Promise<BrandVoiceRow | null> {
  return (await db.query.brandVoices.findFirst({ where: eq(s.brandVoices.organizationId, organizationId) })) ?? null;
}

/**
 * Ask for a narration.
 *
 * Everything that can be refused is refused here, before a row exists and before a provider is
 * paid: the plan's switches, the language (decided, never assumed), a voice native to it, a
 * provider for the quality asked, and the month's allowance against an estimate of the length.
 * What passes is queued; the job does the expensive part.
 */
export async function createNarration(input: CreateNarrationInput): Promise<NarrationRow> {
  const parsed = createNarrationSchema.parse(input);
  const { organizationId } = input;
  const locale = input.locale ?? "en";
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId) });
  if (!organization) throw new NotFoundError("Workspace");

  await requireFeature(organizationId, "audioNarration", "Narration");
  if (EDITION_KINDS.includes(parsed.kind)) await requireFeature(organizationId, "audioEditions", "Audio editions");
  if (parsed.quality === "FINAL") await requireFeature(organizationId, "premiumVoices", "The premium voice");
  if (parsed.options.takes === 2) await requireFeature(organizationId, "multipleTakes", "A second take");
  if (parsed.options.voice === "brand") await requireFeature(organizationId, "brandVoice", "The brand voice");
  if (parsed.options.voice.startsWith("clone:")) await requireFeature(organizationId, "voiceCloning", "A cloned voice");

  const config = await speechConfig();
  const source = await loadSource({ kind: parsed.kind, organizationId, editionId: parsed.editionId, articleId: parsed.articleId, packId: parsed.packId, customText: parsed.customText, includeUnapproved: parsed.quality === "PREVIEW" });

  let resolved;
  let written;
  try {
    written = resolveNarrationLanguage({ text: source.sample, article: source.articleLanguage, publication: source.publicationLanguage, workspace: organization.locale });
    resolved = parsed.options.language === "auto" ? written : resolveNarrationLanguage({ requested: parsed.options.language, text: source.sample, article: source.articleLanguage, publication: source.publicationLanguage, workspace: organization.locale });
  } catch (error) {
    if (error instanceof LanguageUnknownError) throw new ValidationError(error.message);
    throw error;
  }
  if (resolved.language !== written.language) await requireFeature(organizationId, "multilingualNarration", `Narration in ${LANGUAGE_NAMES.en[resolved.language]} of a ${LANGUAGE_NAMES.en[written.language]} text`);

  const blocks = framedBlocks(source, parsed.kind, resolved.language);
  const text = blocksText(blocks);
  if (text.length > config.maxCharacters) throw new ValidationError(`This is ${text.length.toLocaleString()} characters of narration; this Briefly caps one narration at ${config.maxCharacters.toLocaleString()}. Try a digest, or one article at a time.`);

  const brandVoice = await getBrandVoice(organizationId);
  const voice = await resolveVoiceFor({ organizationId, language: resolved.language, options: parsed.options, brandVoice, catalogue: config.voiceCatalogue, cloningEnabled: config.cloningEnabled, locale });
  if (!voice.voice) throw new ValidationError(voice.reason);

  const provider = await getSpeechProvider(parsed.quality);
  if (!provider) throw new ValidationError(locale === "fr" ? "La narration n'est pas encore connectée sur ce Briefly. Demandez à votre administrateur." : "Narration is not connected on this Briefly yet. Ask your administrator.");
  if (voice.voice.kind === "clone" && !provider.cloneVoice) throw new ValidationError("A cloned voice needs the premium voice service, which is not connected for this quality.");

  const seconds = estimateSeconds(text, resolved.language, parsed.options.pace) * parsed.options.takes;
  await assertNarrationAllowance(organizationId, seconds);

  // Pasted words live nowhere but here, so they are kept with the row as the script's first draft;
  // everything else is read afresh from the newsroom when the job runs.
  const draft = parsed.kind === "CUSTOM" ? passagesFrom(blocks, { secondVoice: parsed.options.speakers !== "single" }) : null;
  const script = draft ? { language: resolved.language, title: source.title, passages: draft, ...scriptTotals(draft), source: "local" as const, adaptedAt: new Date().toISOString() } : null;

  const [row] = await db
    .insert(s.narrations)
    .values({
      organizationId,
      publicationId: source.publicationId,
      editionId: parsed.editionId ?? null,
      articleId: parsed.articleId ?? null,
      packId: parsed.packId ?? null,
      kind: parsed.kind,
      quality: parsed.quality,
      status: "QUEUED",
      title: source.title,
      language: resolved.language,
      languageSource: resolved.source,
      accent: parsed.options.accent,
      options: parsed.options,
      voiceKey: voice.voice.voiceKey,
      voiceName: voice.voice.voiceName,
      providerVoiceId: voice.voice.providerVoiceId,
      provider: provider.name,
      model: provider.modelFor(parsed.quality),
      script,
      createdById: input.actorId ?? null,
    })
    .returning();

  await audit({ action: "narration.create", organizationId, userId: input.actorId ?? null, entityType: "EDITION", entityId: parsed.editionId ?? null, editionId: parsed.editionId ?? null, metadata: { narrationId: row.id, kind: row.kind, quality: row.quality, language: row.language, languageSource: row.languageSource, voice: row.voiceKey, estimatedSeconds: Math.round(seconds), note: voice.voice.note } });
  await enqueueNarration(row, input.actorId ?? null);
  log.info("narration queued", { narrationId: row.id, kind: row.kind, language: row.language, voice: row.voiceKey });
  return row;
}

/** Queue the job that performs it. Passages given means "these again", not "everything". */
export async function enqueueNarration(narration: Pick<NarrationRow, "id" | "editionId">, actorId: string | null, passages?: number[]) {
  const job = await enqueueJob({
    type: JOB_TYPES.SPEECH_NARRATE,
    payload: passages?.length ? { narrationId: narration.id, passages } : { narrationId: narration.id },
    idempotencyKey: passages?.length ? `narration:${narration.id}:${passages.join(",")}:${Date.now()}` : `narration:${narration.id}`,
    editionId: narration.editionId ?? null,
    createdById: actorId,
    priority: 4,
    maxAttempts: 2,
  });
  kickJobRunner();
  return job;
}

export async function getNarration(narrationId: string): Promise<NarrationRow> {
  const row = await guardTenant(await db.query.narrations.findFirst({ where: eq(s.narrations.id, narrationId) }), "Narration");
  if (!row) throw new NotFoundError("Narration");
  return row;
}

export async function listNarrations(filter: { editionId?: string | null; packId?: string | null; limit?: number } = {}): Promise<NarrationRow[]> {
  return db.query.narrations.findMany({
    where: await scoped(s.narrations.organizationId, filter.editionId ? eq(s.narrations.editionId, filter.editionId) : undefined, filter.packId ? eq(s.narrations.packId, filter.packId) : undefined),
    orderBy: [desc(s.narrations.createdAt)],
    limit: filter.limit ?? 50,
  });
}

/** The passages as last performed: the newest ready take of each, in order. An alternative take (101 and up) is a separate performance and never stands in. */
export async function currentSegments(narrationId: string): Promise<NarrationSegmentRow[]> {
  const rows = (await db.query.narrationSegments.findMany({ where: eq(s.narrationSegments.narrationId, narrationId), orderBy: [asc(s.narrationSegments.index), desc(s.narrationSegments.take)] })).filter((row) => row.take < 101);
  const seen = new Set<number>();
  const current: NarrationSegmentRow[] = [];
  for (const row of rows) {
    if (seen.has(row.index)) continue;
    // The newest ready take wins; a failed newer take does not hide a ready older one.
    const ready = rows.find((candidate) => candidate.index === row.index && candidate.status === "READY");
    current.push(ready ?? row);
    seen.add(row.index);
  }
  return current;
}

/** The latest ready narration of a pack, for the film's encoder. */
export async function readyNarrationForPack(packId: string): Promise<{ narration: NarrationRow; segments: NarrationSegmentRow[] } | null> {
  const narration = await db.query.narrations.findFirst({ where: and(eq(s.narrations.packId, packId), eq(s.narrations.kind, "VIDEO"), eq(s.narrations.status, "READY"), isNotNull(s.narrations.storageKey)), orderBy: [desc(s.narrations.createdAt)] });
  if (!narration) return null;
  return { narration, segments: await currentSegments(narration.id) };
}

/** Do these passages again — one provider call each, then the master is stitched afresh. */
export async function regeneratePassages(narrationId: string, indices: number[], actorId?: string | null): Promise<NarrationRow> {
  const narration = await getNarration(narrationId);
  if (!narration.script) throw new ValidationError("This narration has no script yet.");
  const valid = indices.filter((index) => Number.isInteger(index) && index >= 0 && index < narration.script!.passages.length);
  if (!valid.length) throw new ValidationError("Choose a passage to regenerate.");
  if (narration.status === "NARRATING" || narration.status === "ADAPTING" || narration.status === "MASTERING") throw new ValidationError("This narration is still being made.");
  const seconds = valid.reduce((total, index) => total + estimateSeconds(narration.script!.passages[index].text, narration.language as SpeechLanguage, narration.options.pace), 0);
  await assertNarrationAllowance(narration.organizationId, seconds);
  await db.update(s.narrations).set({ status: "QUEUED", error: null, updatedAt: new Date() }).where(eq(s.narrations.id, narration.id));
  await audit({ action: "narration.regenerate", organizationId: narration.organizationId, userId: actorId ?? null, editionId: narration.editionId, metadata: { narrationId: narration.id, passages: valid } });
  await enqueueNarration(narration, actorId ?? null, valid);
  return { ...narration, status: "QUEUED" };
}

export async function deleteNarration(narrationId: string, actorId?: string | null) {
  const narration = await getNarration(narrationId);
  const storage = await getStorage();
  const keys = await storage.list(`audio/${narration.id}/`).catch(() => [] as string[]);
  for (const key of keys) await storage.delete(key).catch((error) => log.warn("could not delete narration file", { key, error: error instanceof Error ? error.message : String(error) }));
  await db.delete(s.narrations).where(eq(s.narrations.id, narration.id));
  await audit({ action: "narration.delete", organizationId: narration.organizationId, userId: actorId ?? null, editionId: narration.editionId, metadata: { narrationId: narration.id, title: narration.title, files: keys.length } });
}

/** Let readers hear it: the web edition and the email carry a player from now on. */
export async function setNarrationPublished(narrationId: string, published: boolean, actorId?: string | null): Promise<NarrationRow> {
  const narration = await getNarration(narrationId);
  if (published && narration.status !== "READY") throw new ValidationError("Only a finished narration can be published.");
  const [row] = await db.update(s.narrations).set({ publishedAt: published ? new Date() : null, updatedAt: new Date() }).where(eq(s.narrations.id, narration.id)).returning();
  await audit({ action: published ? "narration.publish" : "narration.unpublish", organizationId: narration.organizationId, userId: actorId ?? null, editionId: narration.editionId, metadata: { narrationId: narration.id } });
  return row;
}

export async function narrationUrl(narrationId: string, options: { download?: boolean; take?: number } = {}): Promise<{ url: string; fileName: string } | null> {
  const narration = await getNarration(narrationId);
  const key = options.take && options.take > 1 ? narration.takes.find((take) => take.take === options.take)?.storageKey : narration.storageKey;
  if (!key) return null;
  const fileName = `${narration.title.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "narration"}${options.take && options.take > 1 ? `-take-${options.take}` : ""}.mp3`;
  const url = await (await getStorage()).getSignedUrl(key, { expiresInSeconds: 3600, download: options.download ? { fileName } : undefined });
  return { url, fileName };
}

/** A public narration's file, for readers. Null unless it was published. */
export async function publishedNarrationUrl(narrationId: string): Promise<string | null> {
  const narration = await db.query.narrations.findFirst({ where: and(eq(s.narrations.id, narrationId), isNotNull(s.narrations.publishedAt), eq(s.narrations.status, "READY")) });
  if (!narration?.storageKey) return null;
  return (await getStorage()).getSignedUrl(narration.storageKey, { expiresInSeconds: 6 * 60 * 60 });
}

export async function publishedNarrationsForEdition(editionId: string): Promise<NarrationRow[]> {
  return db.query.narrations.findMany({ where: and(eq(s.narrations.editionId, editionId), isNotNull(s.narrations.publishedAt), eq(s.narrations.status, "READY")), orderBy: [desc(s.narrations.createdAt)] });
}

/* ── The house voice ──────────────────────────────────────────────────────────────────────── */

export const brandVoicePatchSchema = z.object({
  voiceKey: z.string().max(80).nullable().optional(),
  gender: z.enum(["auto", "female", "male"]).optional(),
  accent: z.enum(ACCENTS).optional(),
  style: z.enum(STYLES).optional(),
  pace: z.enum(PACES).optional(),
  language: z.string().regex(/^[a-z]{2}$/).nullable().optional(),
  pronunciations: z.array(z.object({ term: z.string().trim().min(1).max(80), say: z.string().trim().min(1).max(160), language: z.string().regex(/^[a-z]{2}$/).nullable().optional() })).max(200).optional(),
  cloneId: z.string().uuid().nullable().optional(),
});
export type BrandVoicePatch = z.infer<typeof brandVoicePatchSchema>;

export async function updateBrandVoice(organizationId: string, patch: BrandVoicePatch, actorId?: string | null): Promise<BrandVoiceRow> {
  const values = brandVoicePatchSchema.parse(patch);
  if (values.cloneId) {
    const clone = await db.query.voiceClones.findFirst({ where: eq(s.voiceClones.id, values.cloneId) });
    if (!clone || clone.organizationId !== organizationId) throw new NotFoundError("Voice");
    if (clone.status !== "READY") throw new ValidationError("That voice is not ready.");
    if (!(await hasFeature(organizationId, "voiceCloning"))) throw new ForbiddenError("Cloned voices are not included in your plan.");
  }
  const existing = await getBrandVoice(organizationId);
  const set = { ...values, updatedById: actorId ?? null, updatedAt: new Date() };
  const [row] = existing
    ? await db.update(s.brandVoices).set(set).where(eq(s.brandVoices.id, existing.id)).returning()
    : await db.insert(s.brandVoices).values({ organizationId, ...set }).returning();
  await audit({ action: "voice.brand.update", organizationId, userId: actorId ?? null, entityType: "SETTING", metadata: { fields: Object.keys(values) } });
  return row;
}

/* ── What the screen needs ────────────────────────────────────────────────────────────────── */

export type SpeechOverview = {
  available: { preview: boolean; final: boolean };
  allowance: { limitMinutes: number | null; usedSeconds: number };
  features: { audioNarration: boolean; premiumVoices: boolean; audioEditions: boolean; multilingualNarration: boolean; brandVoice: boolean; voiceCloning: boolean; multipleTakes: boolean };
  /** The languages a voice is set up for, so the language control offers only what can be spoken. */
  languages: SpeechLanguage[];
  cloningEnabled: boolean;
};

export async function speechOverview(organizationId: string): Promise<SpeechOverview> {
  const [available, allowance, plan, config] = await Promise.all([speechAvailability(), narrationAllowance(organizationId), resolveEntitlements(organizationId), speechConfig()]);
  const entitlements = plan.entitlements as Record<string, unknown>;
  const flag = (key: string) => entitlements[key] === true;
  return {
    available,
    allowance,
    features: { audioNarration: flag("audioNarration"), premiumVoices: flag("premiumVoices"), audioEditions: flag("audioEditions"), multilingualNarration: flag("multilingualNarration"), brandVoice: flag("brandVoice"), voiceCloning: flag("voiceCloning"), multipleTakes: flag("multipleTakes") },
    languages: languagesWithVoices(config.voiceCatalogue),
    cloningEnabled: config.cloningEnabled,
  };
}

export function languagesWithVoices(catalogue: VoiceCatalogue): SpeechLanguage[] {
  return [...new Set(resolveCatalogue(catalogue).filter((entry) => entry.providerVoiceId).map((entry) => entry.voice.language))];
}

export function scriptFingerprint(input: { passages: { text: string; speaker: string }[]; voiceKey: string | null; model: string | null; quality: string }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
}

export async function narrationsForEditions(editionIds: string[]): Promise<Map<string, number>> {
  if (!editionIds.length) return new Map();
  const rows = await db.select({ editionId: s.narrations.editionId }).from(s.narrations).where(and(inArray(s.narrations.editionId, editionIds), eq(s.narrations.status, "READY")));
  const counts = new Map<string, number>();
  for (const row of rows) if (row.editionId) counts.set(row.editionId, (counts.get(row.editionId) ?? 0) + 1);
  return counts;
}
