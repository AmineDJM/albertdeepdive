import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { createPack, getPack, setBrief } from "@/server/creative/service";
import { renderSpec } from "@/server/creative/render";
import { ffmpegPath } from "@/server/creative/video";
import { getStorage } from "@/server/storage";
import { ensureDefaultPlans } from "@/server/billing/plans";
import { setOverrides } from "@/server/platform/overrides";
import { saveBrand } from "@/server/brand/service";
import { runQc } from "@/server/qc";
import { FORMATS } from "@/lib/creative/formats";
import type { CreativeBrief, RenderSpec } from "@/lib/creative/brief";

/**
 * A pack that is right, and then the same pack broken four ways.
 *
 * The half that matters most is the first assertion: a correctly drawn carousel must produce no
 * findings at all. Three rules in this engine have already had to be withdrawn or re-severitied
 * because they fired on correct work, and a rule that cries wolf is worse than no rule — people
 * learn to scroll past the panel, and the real failure goes with it.
 *
 * So the pack is composed by the real composer, drawn by the real renderer and stored in real
 * storage, and only then is each defect introduced one at a time: a brand colour changed in one of
 * the two places that hold it, a truncated still, a still at the wrong size, and a video whose
 * bytes stop halfway. Each is measured, and the evidence is expected to name what is wrong rather
 * than merely that something is.
 */
describe("the files the studio makes", () => {
  let orgId: string;
  let adminId: string;
  let editionId: string;
  let packId: string;
  let spec: RenderSpec;
  const keys: string[] = [];
  let declared: Record<string, string | undefined> = {};

  const brief: CreativeBrief = {
    format: "CAROUSEL",
    mode: "STUDIO",
    intent: "Show the work.",
    frames: [
      { layout: "statement", headline: "A first slide with a headline on it", surface: "brand", emphasis: "normal" },
      { layout: "statement", headline: "A second slide that says something else", surface: "paper", emphasis: "normal" },
      { layout: "cta", headline: "And a last slide asking for something", surface: "accent", emphasis: "normal" },
    ],
    caption: "A caption that says something.",
    hashtags: [],
  };

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    await ensureDefaultPlans();
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    orgId = (await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) }))!.organizationId!;
    await setOverrides({ organizationId: orgId, patch: { socialPack: true, creativeCredits: null }, actorId: adminId });

    // One brand, declared in both places it is kept, so the drift rule starts from agreement.
    const brand = await saveBrand({
      organizationId: orgId,
      system: {
        colours: { brand: "#10203A", accent: "#2BAFE0", ink: "#17191C", paper: "#FFFFFF" },
        personality: "editorial",
        shape: { roundness: 0.25, borderWidth: 1, unit: 8 },
        imagery: { treatment: "editorial", grain: 0.12, scrim: 0.45 },
        motion: { pace: "measured" },
        voice: { tone: ["plain"], avoid: [], person: "first" },
        logo: { markUrl: null, wordmarkUrl: null, clearSpace: 0.5 },
      },
      actorId: adminId,
    });
    declared = { primary: brand.system.colours.brand, accent: brand.system.colours.accent, ink: brand.system.colours.ink, paper: brand.system.colours.paper };
    await db.update(s.organizations).set({ brandColours: declared }).where(eq(s.organizations.id, orgId));

    await runAsOrganization(orgId, async () => {
      const pack = await createPack({ organizationId: orgId, name: "QC fixture", format: "CAROUSEL", mode: "STUDIO", actorId: adminId });
      packId = pack.id;
      await setBrief({ packId, brief, actorId: adminId });
    });

    const row = await db.query.creativePacks.findFirst({ where: eq(s.creativePacks.id, packId) });
    spec = row!.spec as RenderSpec;

    // Drawn for real. Nothing here is a stand-in: the bytes measured are the bytes a person posts.
    const storage = await getStorage();
    const frames = await renderSpec(spec);
    const assets = (await getPack(packId)).assets.filter((asset) => asset.kind === "FRAME");
    for (const frame of frames) {
      const asset = assets.find((each) => each.index === frame.index);
      if (!asset) continue;
      const key = `creative/${packId}/frame-${String(frame.index + 1).padStart(2, "0")}.png`;
      await storage.put(key, frame.bytes, { contentType: frame.mimeType });
      keys.push(key);
      await db
        .update(s.creativeAssets)
        .set({ status: "READY", storageKey: key, mimeType: frame.mimeType, width: frame.width, height: frame.height, sizeBytes: frame.bytes.length })
        .where(eq(s.creativeAssets.id, asset.id));
    }
  }, 300_000);

  afterAll(async () => {
    const storage = await getStorage();
    for (const key of keys) await storage.delete(key).catch(() => {});
    await db.delete(s.creativePacks).where(eq(s.creativePacks.id, packId));
  });

  const measure = () => runQc(editionId, { only: ["brand", "creative"], repair: false, persist: false });

  it("says nothing at all about a pack that is right", async () => {
    const report = await measure();
    expect(report.findings, report.findings.map((each) => `${each.metricId}: ${each.message}`).join(" | ")).toEqual([]);

    // And it did measure: a silent check and a passing one must not look the same.
    const measured = report.passed.map((each) => each.metricId);
    expect(measured).toContain("brand.colour.declared");
    expect(measured).toContain("brand.colour.rendered");
    expect(measured).toContain("creative.frame.decodes");
    expect(measured).toContain("creative.frame.canvas");
    // Every drawn frame was looked at, not just the first.
    expect(report.passed.filter((each) => each.metricId === "brand.colour.rendered").length).toBe(keys.length);
  }, 300_000);

  it("measures the colour the file was painted, not the colour somebody meant", async () => {
    const report = await measure();
    const rendered = report.passed.filter((each) => each.metricId === "brand.colour.rendered");
    // A deterministic renderer paints the hex it was given: the distance is zero, not merely small.
    for (const pass of rendered) expect(Number(pass.actual.replace(" deltaE", ""))).toBeLessThan(0.5);
  }, 300_000);

  it("notices when the two places a brand colour lives stop agreeing", async () => {
    // The real bug this is for: Settings writes `brand_colours`, the Studio draws from the brand
    // system, and nothing kept them in step. A customer changes their blue and every frame keeps
    // coming out in the old one.
    await db.update(s.organizations).set({ brandColours: { ...declared, accent: "#C2603C" } }).where(eq(s.organizations.id, orgId));
    try {
      const report = await measure();
      const finding = report.findings.find((each) => each.metricId === "brand.colour.declared");
      expect(finding, "a brand colour that only half the product knows about is a finding").toBeDefined();
      expect(finding!.severity).toBe("FAIL");
      expect(finding!.location.field).toBe("accent");
      expect(finding!.message).toContain("#C2603C");
      expect(finding!.message).toContain("#2BAFE0");
      expect(Number(finding!.actual.replace(" deltaE", "")), "and says how far apart, in the unit printers use").toBeGreaterThan(5);
    } finally {
      await db.update(s.organizations).set({ brandColours: declared }).where(eq(s.organizations.id, orgId));
    }
  }, 300_000);

  it("catches a still that was written and cannot be opened", async () => {
    const storage = await getStorage();
    const key = keys[0];
    const whole = (await storage.get(key))!;
    // A PNG cut in half: the header is perfect, which is why a header read would pass it.
    await storage.put(key, whole.subarray(0, Math.floor(whole.length / 2)), { contentType: "image/png" });
    try {
      const report = await measure();
      const finding = report.findings.find((each) => each.metricId === "creative.frame.decodes");
      expect(finding, "a truncated frame is not a frame").toBeDefined();
      expect(finding!.severity).toBe("CRITICAL_FAIL");
      expect(finding!.actual).toBe("1 count");
    } finally {
      await storage.put(key, whole, { contentType: "image/png" });
    }
  }, 300_000);

  it("catches a still that is the wrong size for where it is posted", async () => {
    const storage = await getStorage();
    const key = keys[1];
    const whole = (await storage.get(key))!;
    const { width, height } = FORMATS.CAROUSEL;
    const shrunk = await sharp(whole).resize(Math.round(width / 2), Math.round(height / 2)).png().toBuffer();
    await storage.put(key, shrunk, { contentType: "image/png" });
    try {
      const report = await measure();
      const finding = report.findings.find((each) => each.metricId === "creative.frame.canvas");
      expect(finding, "a frame Instagram will resample is a frame with soft type on it").toBeDefined();
      const detail = (finding!.evidence as { detail: { why: string }[] }).detail;
      expect(detail[0].why).toContain(`${width}×${height}`);
    } finally {
      await storage.put(key, whole, { contentType: "image/png" });
    }
  }, 300_000);

  it("catches a video whose bytes stop before the end", async () => {
    const encoder = await encodeClip();
    if (!encoder) {
      // No usable ffmpeg here. Saying so is the honest outcome; pretending the rule was exercised
      // is the thing this whole engine exists to refuse.
      console.warn("skipping the video case: no ffmpeg with libx264 on this machine");
      return;
    }
    // A video belongs to a moving format, and the canvas rule is measured against that format's
    // own numbers — so the clip goes in a Reel, not in a carousel it would rightly fail.
    const storage = await getStorage();
    const reel = await runAsOrganization(orgId, () => createPack({ organizationId: orgId, name: "QC clip", format: "REEL", mode: "STUDIO", actorId: adminId }));
    const key = `creative/${reel.id}/clip.mp4`;
    const [asset] = await db
      .insert(s.creativeAssets)
      .values({ organizationId: orgId, packId: reel.id, kind: "VIDEO", index: 0, status: "READY", storageKey: key, mimeType: "video/mp4", sizeBytes: encoder.length })
      .returning({ id: s.creativeAssets.id });
    try {
      // Whole file first: a correct clip must produce nothing.
      await storage.put(key, encoder, { contentType: "video/mp4" });
      const clean = await measure();
      expect(clean.findings.filter((each) => each.metricId.startsWith("creative.video"))).toEqual([]);
      expect(clean.passed.some((each) => each.metricId === "creative.video.decodes")).toBe(true);

      // Then the same clip with its tail cut off, which is what a killed encode leaves behind.
      await storage.put(key, encoder.subarray(0, Math.floor(encoder.length * 0.6)), { contentType: "video/mp4" });
      const broken = await measure();
      const finding = broken.findings.find((each) => each.metricId === "creative.video.decodes");
      expect(finding, "a container that parses and then fails mid-stream is the classic broken output").toBeDefined();
      expect(finding!.severity).toBe("CRITICAL_FAIL");
      // And the whole clip's dimensions and length were measured against the Reel's own numbers.
      expect(clean.passed.some((each) => each.metricId === "creative.video.canvas")).toBe(true);
      expect(clean.passed.some((each) => each.metricId === "creative.video.duration")).toBe(true);
    } finally {
      await db.delete(s.creativeAssets).where(eq(s.creativeAssets.id, asset.id));
      await db.delete(s.creativePacks).where(eq(s.creativePacks.id, reel.id));
      await storage.delete(key).catch(() => {});
    }
  }, 300_000);

  /** Two seconds of a moving test pattern at the Reel canvas, or null when ffmpeg cannot make one. */
  async function encodeClip(): Promise<Buffer | null> {
    const dir = await fs.mkdtemp(join(tmpdir(), "qc-clip-"));
    const out = join(dir, "clip.mp4");
    const args = ["-hide_banner", "-y", "-f", "lavfi", "-i", "testsrc=size=1080x1920:rate=24:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", out];
    const code = await new Promise<number>((resolve) => {
      const child = spawn(ffmpegPath(), args, { stdio: "ignore" });
      child.on("error", () => resolve(-1));
      child.on("close", (status) => resolve(status ?? -1));
    });
    if (code !== 0) return null;
    const bytes = await fs.readFile(out).catch(() => null);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    return bytes;
  }
});
