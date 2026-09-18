import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { FakeSpeechProvider } from "../helpers/fake-speech";
import { setSpeechProviderForTests } from "@/server/speech/providers";
import { createNarration, currentSegments, deleteNarration, getBrandVoice, publishedNarrationUrl, publishedNarrationsForEdition, regeneratePassages, setNarrationPublished, speechOverview, updateBrandVoice } from "@/server/speech/service";
import { runNarration } from "@/server/speech/jobs";
import { requestVoiceClone, revokeVoiceClone } from "@/server/speech/clones";
import { narrationSecondsThisMonth, speechSpend } from "@/server/speech/usage";
import { getStorage } from "@/server/storage";
import { runAsOrganization } from "@/server/tenancy/context";
import { ForbiddenError, ValidationError } from "@/lib/action-result";
import { setOverrides } from "@/server/platform/overrides";
import type { RenderSpec } from "@/lib/creative/brief";

/**
 * A narration, end to end, with the voice provider stood in for.
 *
 * The provider is the one thing faked; the tones it hands back are real files, so every stage
 * after it — measuring, mastering, chaptering, checking, the ledger, the allowance — runs for real.
 */

const FRENCH = `Cette année, les étudiants de la promotion ont présenté leurs projets devant un jury composé de professionnels. Les résultats sont impressionnants, et nous sommes fiers de ce que les équipes ont accompli avec leurs partenaires.

Le BDD de mars a réuni douze équipes autour d'un cas réel, avec un budget de 1,2 M€ et une progression de 40 %. Rendez-vous sur www.albertschool.com pour la suite.`;

const ENGLISH = `Ten new companies joined the programme this term, and the BDD finals brought together twelve teams around a real case worth €1.2M. The results are impressive and we are proud of what the teams achieved with their partners over the year.`;

const SPANISH = `Este año los estudiantes de la promoción presentaron sus proyectos ante un jurado de profesionales. Los resultados son impresionantes y estamos orgullosos de lo que los equipos han logrado con sus socios durante todo el año académico.`;

const provider = new FakeSpeechProvider();

describe("narration", () => {
  let orgId: string;
  let adminId: string;
  let editionId: string;

  beforeAll(async () => {
    await ensureSeeded();
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    adminId = (await db.query.users.findFirst({ where: eq(s.users.email, "admin@albertschool.com") }))!.id;
    editionId = (await db.query.editions.findFirst({ where: eq(s.editions.organizationId, orgId) }))!.id;
    process.env.ELEVENLABS_API_KEY = "sk_test_fake";
    process.env.SPEECH_VOICE_CATALOG = JSON.stringify({ "fr-premium-female": "fake-fr-f", "fr-premium-male": "fake-fr-m", "fr-warm-female": "fake-fr-wf" });
    process.env.SPEECH_CLONING_ENABLED = "true";
    setSpeechProviderForTests(provider);
    // The seed puts the school on Business, which includes narration; the second take is granted here.
    await setOverrides({ organizationId: orgId, patch: { multipleTakes: true }, actorId: adminId });
  });

  afterAll(() => {
    setSpeechProviderForTests(null);
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.SPEECH_VOICE_CATALOG;
    delete process.env.SPEECH_CLONING_ENABLED;
  });

  it("reads French words in French, by a French voice, whatever the workspace speaks", async () => {
    const row = await createNarration({ organizationId: orgId, kind: "CUSTOM", customText: FRENCH, quality: "PREVIEW", options: { voice: "female", language: "auto", accent: "auto", style: "editorial", pace: "natural", takes: 1, speakers: "auto" }, actorId: adminId });
    expect(row.language).toBe("fr");
    expect(row.languageSource).toBe("detected");
    expect(row.voiceKey).toBe("fr-premium-female");
    expect(row.providerVoiceId).toBe("fake-fr-f");
    expect(row.status).toBe("QUEUED");
    await runNarration({ narrationId: row.id });
    const done = (await db.query.narrations.findFirst({ where: eq(s.narrations.id, row.id) }))!;
    expect(done.status).toBe("READY");
    expect(done.script?.language).toBe("fr");
    const spoken = done.script!.passages.map((passage) => passage.plain).join(" ");
    expect(spoken).toContain("1,2 millions euros");
    expect(spoken).toContain("40 pour cent");
    expect(spoken).toContain("albertschool point com");
    expect(spoken).toContain("B. D. D.");
    expect(provider.requests.every((request) => request.language === "fr" && request.voiceId === "fake-fr-f")).toBe(true);
  });

  it("refuses a language it has no native voice for rather than borrowing another", async () => {
    await expect(createNarration({ organizationId: orgId, kind: "CUSTOM", customText: SPANISH, quality: "PREVIEW", options: { voice: "auto", language: "auto", accent: "auto", style: "editorial", pace: "natural", takes: 1, speakers: "auto" }, actorId: adminId })).rejects.toThrow(/No Spanish voice is set up/);
  });

  it("says the newsroom's words the newsroom's way", async () => {
    await updateBrandVoice(orgId, { pronunciations: [{ term: "BDD", say: "business deep dive" }], gender: "male" }, adminId);
    const row = await createNarration({ organizationId: orgId, kind: "CUSTOM", customText: ENGLISH, quality: "PREVIEW", options: { voice: "auto", language: "auto", accent: "british", style: "warm", pace: "slow", takes: 1, speakers: "auto" }, actorId: adminId });
    expect(row.language).toBe("en");
    expect(row.voiceKey).toBe("en-gb-warm-male");
    await runNarration({ narrationId: row.id });
    const done = (await db.query.narrations.findFirst({ where: eq(s.narrations.id, row.id) }))!;
    expect(done.status).toBe("READY");
    const spoken = done.script!.passages.map((passage) => passage.plain).join(" ");
    expect(spoken).toContain("business deep dive");
    expect(spoken).toContain("1.2 million euros");
    expect(spoken).not.toContain("B. D. D.");
    expect(done.direction?.pace).toBe("slow");
    expect(done.direction?.style).toBe("warm");
    await updateBrandVoice(orgId, { pronunciations: [], gender: "auto" }, adminId);
  });

  it("performs an edition passage by passage, masters it, checks it and writes the ledger", { timeout: 300_000 }, async () => {
    const before = await narrationSecondsThisMonth(orgId);
    const row = await createNarration({ organizationId: orgId, kind: "SUMMARY", editionId, quality: "PREVIEW", options: { voice: "female", language: "auto", accent: "auto", style: "editorial", pace: "natural", takes: 1, speakers: "auto" }, actorId: adminId });
    expect(row.language).toBe("en");
    expect(row.title).toContain("·");
    await runNarration({ narrationId: row.id });
    const done = (await db.query.narrations.findFirst({ where: eq(s.narrations.id, row.id) }))!;
    expect(done.status).toBe("READY");
    expect(done.storageKey).toBe(`audio/${row.id}/narration.mp3`);
    expect(await getStorage().exists(done.storageKey!)).toBe(true);
    expect(done.durationSeconds).toBeGreaterThan(10);
    expect(done.sizeBytes).toBeGreaterThan(1000);
    expect(done.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(done.chapters.length).toBeGreaterThan(1);
    expect(done.chapters[0].startSeconds).toBeGreaterThan(0);
    expect(done.chapters[1].startSeconds).toBeGreaterThan(done.chapters[0].startSeconds);
    expect(done.chapters[0].articleId).toMatch(/^[0-9a-f-]{36}$/);
    expect(done.qa?.ok).toBe(true);
    expect(done.characters).toBeGreaterThan(500);
    expect(Number(done.costCents)).toBeGreaterThan(0);

    const segments = await currentSegments(row.id);
    expect(segments.length).toBe(done.script!.passages.length);
    expect(segments.every((segment) => segment.status === "READY" && segment.durationSeconds && segment.sha256)).toBe(true);
    const usage = await db.query.speechUsage.findMany({ where: eq(s.speechUsage.narrationId, row.id) });
    // At least one performance per passage; more when the check sent a passage back to be redone.
    expect(usage.filter((line) => line.operation === "tts").length).toBeGreaterThanOrEqual(segments.length);
    expect(usage.some((line) => line.operation === "master" && line.provider === "briefly")).toBe(true);
    expect(await narrationSecondsThisMonth(orgId)).toBeGreaterThan(before);
    const spend = await speechSpend(orgId, 1);
    expect(spend.cents).toBeGreaterThan(0);
    expect(spend.narrations).toBeGreaterThanOrEqual(3);
    const overview = await speechOverview(orgId);
    expect(overview.features.audioNarration).toBe(true);
    expect(overview.languages).toContain("fr");
    expect(overview.allowance.usedSeconds).toBeGreaterThan(0);
  });

  it("regenerates one passage as a new take and stitches the programme again", { timeout: 300_000 }, async () => {
    const narration = (await db.query.narrations.findFirst({ where: and(eq(s.narrations.organizationId, orgId), eq(s.narrations.kind, "SUMMARY")) }))!;
    const requestsBefore = provider.requests.length;
    await runAsOrganization(orgId, async () => {
      await regeneratePassages(narration.id, [1], adminId);
    });
    await runNarration({ narrationId: narration.id, passages: [1] });
    expect(provider.requests.length).toBe(requestsBefore + 1);
    const segments = await db.query.narrationSegments.findMany({ where: and(eq(s.narrationSegments.narrationId, narration.id), eq(s.narrationSegments.index, 1)) });
    expect(segments.map((segment) => segment.take).sort()).toEqual([1, 2]);
    const current = await currentSegments(narration.id);
    expect(current.find((segment) => segment.index === 1)?.take).toBe(2);
    const after = (await db.query.narrations.findFirst({ where: eq(s.narrations.id, narration.id) }))!;
    expect(after.status).toBe("READY");
    expect(after.script?.passages.length).toBe(narration.script?.passages.length);
  });

  it("redoes on its own the passage the check caught", async () => {
    provider.sabotage.clear();
    const row = await createNarration({ organizationId: orgId, kind: "CUSTOM", customText: `${ENGLISH}\n\n${ENGLISH.replace("Ten", "Twelve")}`, quality: "PREVIEW", options: { voice: "auto", language: "en", accent: "auto", style: "editorial", pace: "natural", takes: 1, speakers: "auto" }, actorId: adminId });
    // The second passage of this narration comes out almost silent the first time it is performed.
    provider.sabotage.set(provider.requests.length + 1, "silent");
    await runNarration({ narrationId: row.id });
    provider.sabotage.clear();
    const done = (await db.query.narrations.findFirst({ where: eq(s.narrations.id, row.id) }))!;
    expect(done.status).toBe("READY");
    const takes = await db.query.narrationSegments.findMany({ where: and(eq(s.narrationSegments.narrationId, row.id), eq(s.narrationSegments.index, 1)) });
    expect(takes.length).toBe(2);
    expect(done.qa?.findings.some((finding) => finding.code === "silent")).toBe(false);
  });

  it("records a second take when the plan allows it", async () => {
    const row = await createNarration({ organizationId: orgId, kind: "CUSTOM", customText: ENGLISH, quality: "FINAL", options: { voice: "auto", language: "en", accent: "us", style: "confident", pace: "natural", takes: 2, speakers: "auto" }, actorId: adminId });
    await runNarration({ narrationId: row.id });
    const done = (await db.query.narrations.findFirst({ where: eq(s.narrations.id, row.id) }))!;
    expect(done.status).toBe("READY");
    expect(done.takes.map((take) => take.take)).toEqual([2]);
    expect(await getStorage().exists(done.takes[0].storageKey)).toBe(true);
    // Two whole performances, not the same one twice.
    expect(done.takes[0].sha256).not.toBe(done.sha256);
    const segments = await db.query.narrationSegments.findMany({ where: eq(s.narrationSegments.narrationId, row.id) });
    expect([...new Set(segments.map((segment) => segment.take))].sort((a, b) => a - b)).toEqual([1, 101]);
    expect((await currentSegments(row.id)).every((segment) => segment.take === 1)).toBe(true);
    expect(done.model).toBe("fake-final");
  });

  it("times a film's narration to its scenes", async () => {
    const spec = {
      format: "REEL",
      mode: "STUDIO",
      system: "editorial",
      width: 1080,
      height: 1920,
      caption: "Ten new companies.",
      hashtags: [],
      brandVersion: "1",
      fingerprint: "narration-test",
      frames: [0, 1].map((index) => ({
        index,
        layout: "statement",
        width: 1080,
        height: 1920,
        background: "#ffffff",
        shapes: [],
        alt: "",
        text: [{ role: "display", content: index === 0 ? "Ten new companies joined the programme this term." : "Twelve teams, one real case, and a jury of professionals.", x: 60, y: 600, width: 960, fontSize: 72, fontFamily: "Inter", fontWeight: 700, letterSpacing: 0, lineHeight: 1.1, colour: "#111111", transform: "none", align: "left", lines: 3 }],
      })),
    } as unknown as RenderSpec;
    const [pack] = await db.insert(s.creativePacks).values({ organizationId: orgId, editionId, name: "Launch film", format: "REEL", mode: "STUDIO", status: "READY", motionSystem: "drift", spec, fingerprint: "narration-test", createdById: adminId }).returning();
    const row = await createNarration({ organizationId: orgId, kind: "VIDEO", packId: pack.id, quality: "PREVIEW", options: { voice: "auto", language: "en", accent: "auto", style: "cinematic", pace: "natural", takes: 1, speakers: "auto" }, actorId: adminId });
    expect(row.title).toBe("Launch film");
    await runNarration({ narrationId: row.id });
    const done = (await db.query.narrations.findFirst({ where: eq(s.narrations.id, row.id) }))!;
    expect(done.status).toBe("READY");
    expect(done.script?.timeline?.holds.length).toBe(2);
    expect(done.script?.passages.map((passage) => passage.sceneIndex)).toEqual([0, 1]);
    expect(done.direction?.context).toBe("launch_film");
    // The film is queued to be encoded again, with the voice under it.
    const render = await db.query.jobs.findFirst({ where: eq(s.jobs.type, "creative.render"), orderBy: (jobs, { desc }) => [desc(jobs.createdAt)] });
    expect(render?.payload).toMatchObject({ packId: pack.id, force: true });
  });

  it("publishes to readers, and deletes cleanly", async () => {
    const narration = (await db.query.narrations.findFirst({ where: and(eq(s.narrations.organizationId, orgId), eq(s.narrations.kind, "SUMMARY")) }))!;
    await runAsOrganization(orgId, async () => {
      expect(await publishedNarrationUrl(narration.id)).toBeNull();
      await setNarrationPublished(narration.id, true, adminId);
      expect(await publishedNarrationUrl(narration.id)).toMatch(/^http/);
      expect((await publishedNarrationsForEdition(editionId)).map((row) => row.id)).toContain(narration.id);
      await deleteNarration(narration.id, adminId);
    });
    expect(await db.query.narrations.findFirst({ where: eq(s.narrations.id, narration.id) })).toBeUndefined();
    expect(await getStorage().list(`audio/${narration.id}/`)).toEqual([]);
  });

  it("clones a voice only with consent on record, and withdraws it for good", async () => {
    const tone = await provider.synthesize({ text: "A sample.", voiceId: "x", language: "en", quality: "PREVIEW", settings: { stability: 0.5, similarity: 0.8, styleExaggeration: 0, speakerBoost: true, speed: 1 } });
    const base = { organizationId: orgId, name: "Marie Dupont — CEO", personName: "Marie Dupont", relation: "executive" as const, language: "fr", consentText: "I, Marie Dupont, agree that Albert School may reproduce my voice for its newsletters until I say otherwise.", samples: [{ bytes: tone.bytes, fileName: "marie.mp3", mimeType: "audio/mpeg" }], actorId: adminId };
    await expect(requestVoiceClone({ ...base, consentConfirmed: false })).rejects.toThrow(ValidationError);
    await expect(requestVoiceClone({ ...base, consentConfirmed: true, consentText: "ok" })).rejects.toThrow(/at least a sentence/);
    const clone = await requestVoiceClone({ ...base, consentConfirmed: true });
    expect(clone.status).toBe("READY");
    expect(clone.providerVoiceId).toBe("fake-clone-1");
    expect(clone.sampleKeys.length).toBe(1);
    expect(provider.clones[0].samples.length).toBe(1);

    await updateBrandVoice(orgId, { cloneId: clone.id }, adminId);
    expect((await getBrandVoice(orgId))?.cloneId).toBe(clone.id);
    const row = await createNarration({ organizationId: orgId, kind: "CUSTOM", customText: FRENCH, quality: "FINAL", options: { voice: "brand", language: "auto", accent: "auto", style: "warm", pace: "natural", takes: 1, speakers: "auto" }, actorId: adminId });
    expect(row.voiceKey).toBe(`clone:${clone.id}`);
    expect(row.providerVoiceId).toBe("fake-clone-1");

    const audits = await db.query.auditLog.findMany({ where: eq(s.auditLog.entityId, clone.id) });
    expect(audits.map((entry) => entry.action).sort()).toEqual(["voice.clone.ready", "voice.clone.request"]);

    const revoked = await revokeVoiceClone(clone.id, orgId, adminId);
    expect(revoked.status).toBe("REVOKED");
    expect(provider.deleted).toContain("fake-clone-1");
    expect((await getBrandVoice(orgId))?.cloneId).toBeNull();
    await expect(createNarration({ organizationId: orgId, kind: "CUSTOM", customText: FRENCH, quality: "FINAL", options: { voice: `clone:${clone.id}`, language: "auto", accent: "auto", style: "warm", pace: "natural", takes: 1, speakers: "auto" }, actorId: adminId })).rejects.toThrow(/not ready/);
  });

  it("keeps narration behind the plan", async () => {
    await setOverrides({ organizationId: orgId, patch: { audioNarration: false }, actorId: adminId });
    await expect(createNarration({ organizationId: orgId, kind: "CUSTOM", customText: ENGLISH, quality: "PREVIEW", options: { voice: "auto", language: "en", accent: "auto", style: "editorial", pace: "natural", takes: 1, speakers: "auto" }, actorId: adminId })).rejects.toThrow(ForbiddenError);
    await setOverrides({ organizationId: orgId, patch: { audioNarration: undefined, narrationMinutes: 1 }, actorId: adminId });
    await expect(createNarration({ organizationId: orgId, kind: "EDITION", editionId, quality: "PREVIEW", options: { voice: "auto", language: "en", accent: "auto", style: "editorial", pace: "natural", takes: 1, speakers: "auto" }, actorId: adminId })).rejects.toThrow(/minutes of narration/);
    await setOverrides({ organizationId: orgId, patch: { narrationMinutes: undefined }, actorId: adminId });
  });
});
