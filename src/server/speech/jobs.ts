import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { getStorage } from "@/server/storage";
import { JOB_TYPES, registerJobHandler, type JobContext } from "@/server/jobs/registry";
import { notifyUsers } from "@/server/editorial/notifications";
import { activeBrand } from "@/server/brand/service";
import { baseDirection, contextForKind } from "@/lib/speech/direction";
import type { SpeechLanguage } from "@/lib/speech/language";
import { inspectNarration, verdictFor, type NarrationFinding } from "@/lib/speech/qa";
import { passagesFrom, scriptTotals } from "@/lib/speech/script";
import { SCENE_PADDING_SECONDS, holdsForNarration, sceneStarts } from "@/lib/speech/timing";
import type { SpeechScript, VoiceDirection } from "@/lib/speech/types";
import { curatedVoice } from "@/lib/speech/voices";
import { motionSystem } from "@/lib/creative/motion";
import { adaptScript, directScript } from "./adapter";
import { secondVoiceFor, type ResolvedVoice } from "./catalog";
import { masterNarration, measureAudio } from "./mastering";
import { getSpeechProvider, speechConfig, type SpeechProvider } from "./providers";
import { openAiVoiceFor } from "./providers/openai";
import { SpeechProviderError } from "./providers/types";
import { currentSegments, getBrandVoice, scriptFingerprint, type NarrationRow, type NarrationSegmentRow } from "./service";
import { framedBlocks, loadSource } from "./sources";
import { recordSpeechUsage } from "./usage";

const log = createLogger("speech-jobs");

/**
 * Making a narration, off the request.
 *
 * Adapt, direct, perform, master, check — each stage writes its result to the row before the next
 * begins, so a failure leaves something to look at and a retry resumes rather than restarts. The
 * passages are the unit of work throughout: performed one at a time with their neighbours for
 * context, stored one file each, and regenerated one at a time when the check names one.
 */

type Payload = { narrationId: string; passages?: number[] };

const keyFor = (narrationId: string, name: string) => `audio/${narrationId}/${name}`;

/**
 * Where alternative takes live in the take numbering.
 *
 * A passage's takes below this are its history — the first performance and every redo, the
 * newest of which is the one heard. From here up is a second, whole performance the person may
 * prefer, kept apart so a redo can never be mistaken for it and it can never displace the first.
 */
export const ALTERNATIVE_TAKE = 101;

async function setStatus(narrationId: string, status: NarrationRow["status"], extra: Partial<typeof s.narrations.$inferInsert> = {}) {
  await db.update(s.narrations).set({ status, updatedAt: new Date(), ...extra }).where(eq(s.narrations.id, narrationId));
}

/** The provider's voice for ours: a fixed-voice fallback provider gets the nearest of its own. */
function providerVoiceId(provider: SpeechProvider, voice: { voiceKey: string | null; providerVoiceId: string | null; gender: "female" | "male" | "auto" }): string {
  if (provider.name === "openai") return openAiVoiceFor(voice.voiceKey, voice.gender);
  if (!voice.providerVoiceId) throw new Error("This narration has no voice.");
  return voice.providerVoiceId;
}

async function synthesizeWithRetries(provider: SpeechProvider, request: Parameters<SpeechProvider["synthesize"]>[0], retries: number) {
  let attempt = 0;
  for (;;) {
    try {
      return await provider.synthesize(request);
    } catch (error) {
      const retryable = error instanceof SpeechProviderError ? error.retryable : true;
      attempt += 1;
      if (!retryable || attempt > retries) throw error;
      const wait = 2000 * attempt;
      log.warn("passage failed, retrying", { attempt, wait, error: error instanceof Error ? error.message : String(error) });
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

type Performed = { index: number; take: number; segment: NarrationSegmentRow };

/** Perform the passages listed, at the take given, and keep each one. */
async function performPassages(input: {
  narration: NarrationRow;
  script: SpeechScript;
  direction: VoiceDirection;
  indices: number[];
  takeFor: (index: number) => number;
  provider: SpeechProvider;
  primaryVoiceId: string;
  secondVoiceId: string | null;
  retries: number;
  ctx?: JobContext;
  progressBase: number;
  progressTotal: number;
  directory: string;
}): Promise<Performed[]> {
  const { narration, script, direction, provider } = input;
  const storage = await getStorage();
  const performed: Performed[] = [];
  const language = narration.language as SpeechLanguage;
  let previousRequestId: string | null = null;
  let done = 0;

  for (const index of input.indices) {
    const passage = script.passages[index];
    if (!passage) continue;
    const take = input.takeFor(index);
    const voiceId = passage.speaker === "second" && input.secondVoiceId ? input.secondVoiceId : input.primaryVoiceId;
    const previous = script.passages[index - 1]?.plain ?? null;
    const next = script.passages[index + 1]?.plain ?? null;
    const [row] = await db
      .insert(s.narrationSegments)
      .values({ organizationId: narration.organizationId, narrationId: narration.id, index, take, speaker: passage.speaker, text: passage.text, characters: passage.text.length, status: "PENDING", provider: provider.name, model: provider.modelFor(narration.quality), providerVoiceId: voiceId })
      .onConflictDoUpdate({ target: [s.narrationSegments.narrationId, s.narrationSegments.index, s.narrationSegments.take], set: { text: passage.text, characters: passage.text.length, status: "PENDING", error: null, provider: provider.name, providerVoiceId: voiceId, updatedAt: new Date() } })
      .returning();

    try {
      const result = await synthesizeWithRetries(
        provider,
        {
          text: passage.text,
          voiceId,
          language,
          quality: narration.quality,
          settings: direction.settings,
          stance: direction.stance,
          previousText: voiceId === input.primaryVoiceId ? previous : null,
          nextText: voiceId === input.primaryVoiceId ? next : null,
          previousRequestIds: previousRequestId && voiceId === input.primaryVoiceId ? [previousRequestId] : [],
          seed: take > 1 ? 1000 + take * 7919 + index : null,
          model: narration.model,
        },
        input.retries,
      );
      const path = join(input.directory, `p${index}-t${take}.mp3`);
      await writeFile(path, result.bytes);
      const measure = await measureAudio(path);
      const key = keyFor(narration.id, `p${String(index).padStart(3, "0")}-t${take}.mp3`);
      await storage.put(key, result.bytes, { contentType: result.mimeType, cacheControl: "private, max-age=31536000, immutable" });
      const sha256 = createHash("sha256").update(result.bytes).digest("hex");
      const [segment] = await db
        .update(s.narrationSegments)
        .set({ status: "READY", storageKey: key, mimeType: result.mimeType, durationSeconds: measure.durationSeconds, sizeBytes: result.bytes.length, sha256, meanVolumeDb: measure.meanVolumeDb, providerRequestId: result.requestId, model: result.model, provider: result.provider, error: null, updatedAt: new Date() })
        .where(eq(s.narrationSegments.id, row.id))
        .returning();
      await recordSpeechUsage({ organizationId: narration.organizationId, narrationId: narration.id, segmentId: segment.id, provider: result.provider, model: result.model, operation: "tts", quality: narration.quality, characters: result.characters, seconds: measure.durationSeconds, costCents: result.costCents, createdById: narration.createdById });
      if (voiceId === input.primaryVoiceId) previousRequestId = result.requestId;
      performed.push({ index, take, segment });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.update(s.narrationSegments).set({ status: "FAILED", error: message.slice(0, 500), updatedAt: new Date() }).where(eq(s.narrationSegments.id, row.id));
      throw error;
    }
    done += 1;
    await input.ctx?.progress(input.progressBase + done, input.progressTotal, `passage ${index + 1}`);
  }
  return performed;
}

type Placement = { placements: number[] | null; holds: number[] | null; overruns: number[] };

/** Where each passage sits in time. A film's passages start with their scenes; anything else just follows on. */
function placementFor(script: SpeechScript, segments: NarrationSegmentRow[]): Placement {
  if (!script.timeline) return { placements: null, holds: null, overruns: [] };
  const durations: (number | null)[] = script.timeline.holds.map(() => null);
  for (const passage of script.passages) {
    if (passage.sceneIndex === null || passage.sceneIndex === undefined) continue;
    const segment = segments.find((row) => row.index === passage.index);
    if (segment?.durationSeconds) durations[passage.sceneIndex] = (durations[passage.sceneIndex] ?? 0) + segment.durationSeconds;
  }
  const { holds, overruns } = holdsForNarration(script.timeline.holds.map((hold) => ({ hold })), durations);
  const starts = sceneStarts(holds, script.timeline.transitionSeconds);
  const placements = script.passages.map((passage) => (passage.sceneIndex !== null && passage.sceneIndex !== undefined ? starts[passage.sceneIndex] + SCENE_PADDING_SECONDS : 0));
  return { placements, holds, overruns };
}

/** Stitch the current take of every passage into the programme, and write it down. */
async function master(narration: NarrationRow, script: SpeechScript, segments: NarrationSegmentRow[], directory: string, take: number): Promise<{ storageKey: string; durationSeconds: number; sizeBytes: number; sha256: string; chapters: NarrationRow["chapters"]; holds: number[] | null; overruns: number[] }> {
  const storage = await getStorage();
  const ordered = script.passages.map((passage) => segments.find((row) => row.index === passage.index && row.status === "READY"));
  const missing = ordered.findIndex((segment) => !segment?.storageKey);
  if (missing >= 0) throw new Error(`Passage ${missing + 1} has no audio.`);
  const ready = ordered as (NarrationSegmentRow & { storageKey: string })[];

  const paths: string[] = [];
  for (const segment of ready) {
    const bytes = await storage.get(segment.storageKey);
    if (!bytes) throw new Error(`The audio for passage ${segment.index + 1} is missing from storage.`);
    const path = join(directory, `m-${segment.index}-${segment.take}.mp3`);
    await writeFile(path, bytes);
    paths.push(path);
  }
  const durations = ready.map((segment) => segment.durationSeconds ?? 0);
  const placement = placementFor(script, ready);
  const output = join(directory, take > 1 ? `narration-take${take}.mp3` : "narration.mp3");
  const mastered = await masterNarration({
    segments: paths,
    durations,
    output,
    placements: placement.placements ?? undefined,
    targetLufs: narration.kind === "VIDEO" ? -14 : -16,
    metadata: { title: narration.title, comment: `${narration.language} · ${narration.voiceName ?? ""}`.trim() },
  });
  const storageKey = keyFor(narration.id, take > 1 ? `narration-take${take}.mp3` : "narration.mp3");
  await storage.put(storageKey, mastered.bytes, { contentType: mastered.mimeType, cacheControl: "private, max-age=31536000, immutable" });

  // Chapters: where each article (or the intro) starts, from the placements of its first passage.
  const starts = placement.placements ?? (() => {
    let cursor = 0;
    return durations.map((duration) => {
      const start = cursor;
      cursor += duration + 0.65;
      return start;
    });
  })();
  const chapters: NarrationRow["chapters"] = [];
  let lastChapter: string | null | undefined = undefined;
  script.passages.forEach((passage, position) => {
    const title = passage.chapter ?? null;
    if (title && title !== lastChapter) {
      if (chapters.length) chapters[chapters.length - 1].endSeconds = Math.round(starts[position] * 100) / 100;
      chapters.push({ title, startSeconds: Math.round(starts[position] * 100) / 100, endSeconds: mastered.durationSeconds, articleId: passage.sourceId ?? null, passageIndex: passage.index });
    }
    lastChapter = title ?? lastChapter;
  });
  return { storageKey, durationSeconds: mastered.durationSeconds, sizeBytes: mastered.bytes.length, sha256: mastered.sha256, chapters, holds: placement.holds, overruns: placement.overruns };
}

async function notify(narration: NarrationRow, type: "NARRATION_READY" | "NARRATION_FAILED", title: string, body: string | null) {
  if (!narration.createdById) return;
  const href = narration.editionId ? `/editions/${narration.editionId}/audio` : narration.packId ? `/studio/${narration.packId}` : "/settings/voice";
  await notifyUsers([narration.createdById], { type, title, body, entityType: narration.editionId ? "EDITION" : null, entityId: narration.editionId ?? null, href });
}

export async function runNarration(payload: Payload, ctx?: JobContext): Promise<{ status: string; passages: number }> {
  const narration = await db.query.narrations.findFirst({ where: eq(s.narrations.id, payload.narrationId) });
  if (!narration) throw new Error("Narration not found");
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, narration.organizationId) });
  if (!organization) throw new Error("Workspace not found");
  const locale = organization.locale === "fr" ? "fr" : "en";
  const config = await speechConfig();
  const provider = await getSpeechProvider(narration.quality);
  const regenerate = payload.passages?.length ? [...new Set(payload.passages)].sort((a, b) => a - b) : null;
  const directory = await mkdtemp(join(tmpdir(), "briefly-narration-"));

  try {
    if (!provider) throw new Error(locale === "fr" ? "La narration n'est pas connectée sur ce Briefly." : "Narration is not connected on this Briefly.");
    const brandVoice = await getBrandVoice(narration.organizationId);
    const pronunciations = brandVoice?.pronunciations ?? [];
    const language = narration.language as SpeechLanguage;
    let script = narration.script;
    let direction = narration.direction;

    if (!regenerate || !script || !direction) {
      await setStatus(narration.id, "ADAPTING", { error: null });
      await ctx?.progress(0, 10, "adapting the words for the ear");
      const source = await loadSource({ kind: narration.kind, organizationId: narration.organizationId, editionId: narration.editionId, articleId: narration.articleId, packId: narration.packId, customText: narration.kind === "CUSTOM" ? (narration.script?.passages.map((passage) => passage.plain).join("\n\n") || narration.title) : null, includeUnapproved: narration.quality === "PREVIEW" });
      const blocks = framedBlocks(source, narration.kind, language);
      const raw = passagesFrom(blocks, { secondVoice: narration.options.speakers !== "single" });
      const brand = await activeBrand(narration.organizationId).catch(() => null);
      const base = baseDirection({ context: narration.options.context ?? contextForKind(narration.kind), style: narration.options.style, pace: narration.options.pace, locale });
      direction = await directScript(base, { organizationName: source.organizationName, language, tone: brand?.system.voice.tone ?? [], excerpt: raw.slice(0, 3).map((passage) => passage.plain).join("\n"), ctx: { editionId: narration.editionId, jobId: ctx?.job.id ?? null } });
      const written = narration.languageSource === "requested" ? null : language;
      const sourceLanguage = written ?? (source.articleLanguage as SpeechLanguage | null) ?? (source.publicationLanguage as SpeechLanguage | null);
      const adapted = await adaptScript({
        passages: raw,
        language,
        sourceLanguage: sourceLanguage && sourceLanguage !== language ? sourceLanguage : null,
        mode: narration.kind === "SUMMARY" ? "summary" : narration.kind === "EXECUTIVE" ? "executive" : "full",
        pace: narration.options.pace,
        direction,
        pronunciations,
        organizationName: source.organizationName,
        ctx: { editionId: narration.editionId, jobId: ctx?.job.id ?? null },
      });
      const totals = scriptTotals(adapted.passages);
      const pack = narration.packId ? await db.query.creativePacks.findFirst({ where: eq(s.creativePacks.id, narration.packId), columns: { motionSystem: true } }) : null;
      script = {
        language,
        title: narration.title,
        passages: adapted.passages,
        words: totals.words,
        characters: totals.characters,
        source: adapted.source,
        adaptedAt: new Date().toISOString(),
        timeline: source.sceneHolds ? { holds: source.sceneHolds, transitionSeconds: motionSystem(pack?.motionSystem).transitionSeconds } : null,
      };
      if (totals.characters > config.maxCharacters) throw new Error(`The script is ${totals.characters.toLocaleString()} characters; this Briefly caps a narration at ${config.maxCharacters.toLocaleString()}.`);
      await setStatus(narration.id, "NARRATING", { script, direction, fingerprint: scriptFingerprint({ passages: script.passages.map((passage) => ({ text: passage.text, speaker: passage.speaker })), voiceKey: narration.voiceKey, model: narration.model, quality: narration.quality }) });
    } else {
      await setStatus(narration.id, "NARRATING", { error: null });
    }

    const primaryVoice: ResolvedVoice = { voiceKey: narration.voiceKey ?? "", voiceName: narration.voiceName ?? "", providerVoiceId: narration.providerVoiceId ?? "", gender: curatedVoice(narration.voiceKey)?.gender ?? "auto", kind: narration.voiceKey?.startsWith("clone:") ? "clone" : "curated", exact: true, note: null };
    const primaryVoiceId = providerVoiceId(provider, primaryVoice);
    const second = narration.options.speakers !== "single" && provider.name !== "openai" ? secondVoiceFor(language, curatedVoice(narration.voiceKey), config.voiceCatalogue, locale) : null;
    const secondVoiceId = second ? providerVoiceId(provider, second) : null;

    const existing = await db.query.narrationSegments.findMany({ where: eq(s.narrationSegments.narrationId, narration.id) });
    const maxTake = (index: number) => existing.filter((row) => row.index === index && row.take < ALTERNATIVE_TAKE).reduce((max, row) => Math.max(max, row.take), 0);
    const passageIndices = script.passages.map((passage) => passage.index);

    // Which passages to perform: the ones asked for again, or every one not already performed as written.
    const takesWanted = regenerate ? 1 : narration.options.takes;
    const plan: { indices: number[]; takeFor: (index: number) => number }[] = [];
    if (regenerate) plan.push({ indices: regenerate.filter((index) => passageIndices.includes(index)), takeFor: (index) => maxTake(index) + 1 });
    else {
      for (let which = 1; which <= takesWanted; which += 1) {
        const take = which === 1 ? 1 : ALTERNATIVE_TAKE;
        const todo = passageIndices.filter((index) => !existing.some((row) => row.index === index && row.take === take && row.status === "READY" && row.text === script!.passages[index].text));
        plan.push({ indices: todo, takeFor: () => take });
      }
    }
    const total = plan.reduce((n, step) => n + step.indices.length, 0);
    let base = 0;
    for (const step of plan) {
      if (!step.indices.length) continue;
      await performPassages({ narration, script, direction, indices: step.indices, takeFor: step.takeFor, provider, primaryVoiceId, secondVoiceId, retries: config.retries, ctx, progressBase: base, progressTotal: total + 1, directory });
      base += step.indices.length;
    }

    await setStatus(narration.id, "MASTERING");
    await ctx?.progress(total, total + 1, "mastering");
    let segments = await currentSegments(narration.id);
    let mastered = await master(narration, script, segments, directory, 1);

    // The check, and one round of putting right what it found — bounded, so a passage the provider
    // keeps getting wrong is reported rather than paid for forever.
    const scenes = script.timeline ? script.timeline.holds.map((hold, index) => ({ index, hold })) : undefined;
    const measure = (rows: NarrationSegmentRow[]) => rows.map((row) => ({ index: row.index, status: row.status, durationSeconds: row.durationSeconds, characters: row.characters, meanVolumeDb: row.meanVolumeDb, sha256: row.sha256, error: row.error }));
    let findings: NarrationFinding[] = inspectNarration({ language, pace: narration.options.pace, passages: script.passages, segments: measure(segments), scenes });
    const defects = findings.filter((finding) => finding.severity === "defect" && finding.passage !== null && ["silent", "truncated", "rushed", "duplicate-audio", "missing-audio"].includes(finding.code)).map((finding) => finding.passage as number);
    if (defects.length && !regenerate) {
      log.info("voice QA found passages to redo", { narrationId: narration.id, passages: defects });
      await performPassages({ narration, script, direction, indices: [...new Set(defects)], takeFor: (index) => maxTake(index) + 2, provider, primaryVoiceId, secondVoiceId, retries: config.retries, ctx, progressBase: total, progressTotal: total + 1, directory });
      segments = await currentSegments(narration.id);
      mastered = await master(narration, script, segments, directory, 1);
      findings = inspectNarration({ language, pace: narration.options.pace, passages: script.passages, segments: measure(segments), scenes });
    }
    for (const index of mastered.overruns) findings.push({ code: "over-scene", severity: "note", message: `Scene ${index + 1} is held longer than planned to fit its narration.`, passage: script.passages.find((passage) => passage.sceneIndex === index)?.index ?? null });
    const verdict = verdictFor(findings);

    const takes: NarrationRow["takes"] = [];
    if (!regenerate && narration.options.takes === 2) {
      const alternative = await db.query.narrationSegments.findMany({ where: and(eq(s.narrationSegments.narrationId, narration.id), eq(s.narrationSegments.take, ALTERNATIVE_TAKE)) });
      const secondTake = await master(narration, script, alternative, directory, 2).catch((error) => {
        log.warn("second take could not be mastered", { narrationId: narration.id, error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      if (secondTake) takes.push({ take: 2, storageKey: secondTake.storageKey, durationSeconds: secondTake.durationSeconds, sizeBytes: secondTake.sizeBytes, sha256: secondTake.sha256 });
    }

    await recordSpeechUsage({ organizationId: narration.organizationId, narrationId: narration.id, provider: "briefly", operation: "master", seconds: mastered.durationSeconds, costCents: 0, createdById: narration.createdById });
    await setStatus(narration.id, "READY", {
      script,
      direction,
      storageKey: mastered.storageKey,
      mimeType: "audio/mpeg",
      durationSeconds: mastered.durationSeconds,
      sizeBytes: mastered.sizeBytes,
      sha256: mastered.sha256,
      chapters: mastered.chapters,
      qa: { ok: verdict.ok, summary: verdict.summary, findings, checkedAt: new Date().toISOString() },
      takes: regenerate ? narration.takes : takes,
      error: null,
    });
    await audit({ action: "narration.ready", organizationId: narration.organizationId, userId: narration.createdById, editionId: narration.editionId, metadata: { narrationId: narration.id, seconds: mastered.durationSeconds, passages: script.passages.length, qa: verdict.summary, provider: provider.name } });
    const minutes = Math.max(1, Math.round(mastered.durationSeconds / 60));
    await notify(narration, "NARRATION_READY", locale === "fr" ? `Narration prête : ${narration.title}` : `Narration ready: ${narration.title}`, locale === "fr" ? `${minutes} min · ${verdict.summary}` : `${minutes} min · ${verdict.summary}`);

    // A film's narration is heard only once the film is encoded with it.
    if (narration.kind === "VIDEO" && narration.packId) {
      const pack = await db.query.creativePacks.findFirst({ where: eq(s.creativePacks.id, narration.packId), columns: { id: true, fingerprint: true, organizationId: true } });
      if (pack) {
        const { enqueueRender } = await import("@/server/creative/jobs");
        await enqueueRender(pack, narration.createdById, { force: true, reason: `narration:${narration.id}:${mastered.sha256.slice(0, 12)}` });
      }
    }
    log.info("narration ready", { narrationId: narration.id, seconds: mastered.durationSeconds, qa: verdict.summary });
    return { status: "READY", passages: script.passages.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setStatus(narration.id, "FAILED", { error: message.slice(0, 500) });
    await audit({ action: "narration.failed", organizationId: narration.organizationId, userId: narration.createdById, editionId: narration.editionId, metadata: { narrationId: narration.id, error: message.slice(0, 200) } });
    await notify(narration, "NARRATION_FAILED", locale === "fr" ? `Narration échouée : ${narration.title}` : `Narration failed: ${narration.title}`, message.slice(0, 200));
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

registerJobHandler<Payload, { status: string; passages: number }>(JOB_TYPES.SPEECH_NARRATE, (payload, ctx) => runNarration(payload, ctx));
