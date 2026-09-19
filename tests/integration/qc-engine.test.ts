import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { getStorage } from "@/server/storage";
import { runQc, requireQcPass, QcBlockedError } from "@/server/qc";
import { QC_SPEC_VERSION } from "@/server/qc/spec";
import type { Finding, QcReport } from "@/server/qc/types";

/**
 * An issue with things deliberately wrong with it, and an engine that has to find them.
 *
 * This is the test the whole spec turns on. Not "does the checker run" but: given a real edition
 * with real defects injected one at a time, does each one come back as a *measurement* — a metric,
 * an expected value, an actual value, a unit, a place — rather than as an adjective; are the
 * repairable ones repaired and proved gone by a second measurement taken with the same code; and
 * does what survives actually stop the issue being published.
 *
 * The defects are chosen because each has shipped, somewhere, in a real product: a logo used as an
 * interview's photograph, a library whose files a container replacement took, a picture whose
 * rights were refused, and a thumbnail stretched across a page at a resolution no press will hold.
 */
describe("the quality engine on a broken issue", () => {
  let editionId: string;
  let organizationId: string;
  let logoId: string;
  let storyId: string;
  let vanishedKey: string;
  let vanishedId: string;
  let refusedId: string;
  let coarseId: string;

  const find = (report: QcReport, metricId: string, entityId?: string): Finding | undefined =>
    report.findings.find((finding) => finding.metricId === metricId && (!entityId || finding.location.entityId === entityId));

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;

    const story = await db.query.stories.findFirst({ where: eq(s.stories.editionId, editionId) });
    storyId = story!.id;

    // ── defect 1: a logo placed as a story's photograph ──
    const logo = await db.query.mediaAssets.findFirst({ where: and(eq(s.mediaAssets.organizationId, organizationId), eq(s.mediaAssets.kind, "logo")) });
    logoId = logo!.id;
    await db.insert(s.storyMedia).values({ storyId, mediaAssetId: logoId, role: "hero", sortOrder: 0 }).onConflictDoNothing();

    // ── defect 2: a picture whose bytes are gone from storage ──
    const photos = await db.query.mediaAssets.findMany({
      where: and(eq(s.mediaAssets.organizationId, organizationId), eq(s.mediaAssets.kind, "photo")),
      limit: 4,
    });
    vanishedId = photos[0].id;
    vanishedKey = photos[0].storageKey;
    const storage = await getStorage();
    const saved = await storage.get(vanishedKey);
    await storage.delete(vanishedKey);
    // Its variants go too, or the document would simply fall back to one of those.
    for (const variant of await db.query.mediaVariants.findMany({ where: eq(s.mediaVariants.assetId, vanishedId) })) {
      await storage.delete(variant.storageKey);
    }
    await db.insert(s.storyMedia).values({ storyId, mediaAssetId: vanishedId, role: "gallery", sortOrder: 1 }).onConflictDoNothing();
    void saved;

    // ── defect 3: a picture whose rights are refused, placed anyway ──
    refusedId = photos[1].id;
    await db.update(s.mediaAssets).set({ rightsStatus: "RED" }).where(eq(s.mediaAssets.id, refusedId));
    await db.insert(s.storyMedia).values({ storyId, mediaAssetId: refusedId, role: "gallery", sortOrder: 2 }).onConflictDoNothing();

    // ── defect 4: a picture far too coarse for a press ──
    coarseId = photos[2].id;
    await db.update(s.mediaAssets).set({ width: 420, height: 280 }).where(eq(s.mediaAssets.id, coarseId));
    await db.update(s.mediaVariants).set({ width: 420, height: 280 }).where(and(eq(s.mediaVariants.assetId, coarseId), eq(s.mediaVariants.kind, "PRINT")));
    await db.insert(s.storyMedia).values({ storyId, mediaAssetId: coarseId, role: "gallery", sortOrder: 3 }).onConflictDoNothing();
  }, 180_000);

  it("measures each injected defect rather than describing it", async () => {
    // Asset-level checks only: no render, so this is fast and isolates what is being proved.
    const report = await runQc(editionId, { profile: "PRINT", only: ["storage", "imagery", "rights"], repair: false, persist: false });

    expect(report.specVersion).toBe(QC_SPEC_VERSION);
    expect(report.profile).toBe("PRINT");
    expect(report.ok, "an issue with these defects cannot be ok").toBe(false);

    // A logo is not a photograph, and the engine says which rule and why.
    const logo = find(report, "image.eligible", logoId);
    expect(logo, "the logo placed as a hero must be found").toBeTruthy();
    expect(logo!.severity).toBe("HARD_FAIL");
    expect(logo!.actual.toLowerCase()).toContain("logo");
    expect(logo!.repairStrategy).toBe("drop-ineligible-asset");

    // Bytes that are gone, named by key.
    const missing = find(report, "storage.object.present", vanishedId);
    expect(missing, "the picture whose file went must be found").toBeTruthy();
    expect(missing!.severity).toBe("HARD_FAIL");
    expect(missing!.actual).toBe("missing");
    expect(missing!.evidence).toMatchObject({ key: expect.stringContaining(vanishedId) });

    // Refused rights, as a hard failure rather than a note.
    const rights = find(report, "rights.cleared", refusedId);
    expect(rights, "the refused picture must be found").toBeTruthy();
    expect(rights!.severity).toBe("HARD_FAIL");
    expect(rights!.expected).toBe("GREEN or YELLOW");
    expect(rights!.actual).toBe("RED");

    // Resolution, measured at the size it is placed and compared with the *profile's* floor.
    const ppi = find(report, "image.effective.ppi", coarseId);
    expect(ppi, "the coarse picture must be found").toBeTruthy();
    expect(ppi!.unit).toBe("ppi");
    expect(ppi!.expected).toBe("≥ 300 ppi");
    expect(Number(ppi!.beforeValue)).toBeLessThan(300);
    expect(ppi!.evidence).toMatchObject({ profile: "PRINT", sourcePixels: 420 });
  }, 180_000);

  it("judges the same issue differently for a screen, because the profile differs", async () => {
    // The same picture, the same measurement, a different destination. 420px across half an A4 is
    // about 100 PPI: short of PRINT's 300 and also short of the screen profile's 144, but the
    // *expected* value quoted must be the profile's own.
    const screen = await runQc(editionId, { profile: "PDF_SCREEN", only: ["imagery"], repair: false, persist: false });
    const ppi = find(screen, "image.effective.ppi", coarseId);
    expect(ppi!.expected).toBe("≥ 144 ppi");
  }, 120_000);

  it("repairs what is repairable and proves it with a second measurement", async () => {
    const report = await runQc(editionId, { profile: "PRINT", only: ["storage", "imagery", "rights"], repair: true, persist: true });

    // The logo was taken off the story, and the remeasure no longer finds it.
    const repairedLogo = report.repairs.find((outcome) => outcome.strategy === "drop-ineligible-asset" && outcome.location.entityId === logoId);
    expect(repairedLogo?.succeeded, "the logo must have been unlinked").toBe(true);
    expect(repairedLogo!.after).toBe("not placed");
    const stillPlaced = await db
      .select({ id: s.storyMedia.mediaAssetId })
      .from(s.storyMedia)
      .where(and(eq(s.storyMedia.storyId, storyId), eq(s.storyMedia.mediaAssetId, logoId)));
    expect(stillPlaced, "the link is gone in the database too, not just in the report").toEqual([]);

    const logoFinding = find(report, "image.eligible", logoId);
    if (logoFinding) {
      expect(logoFinding.repaired, "a finding that is gone on the second pass is marked repaired").toBe(true);
      expect(logoFinding.beforeValue).toBeTruthy();
      expect(logoFinding.afterValue).toBeTruthy();
    }

    // The missing file could not be repaired: the original is gone too, and the engine says so
    // rather than inventing a picture.
    const attempted = report.repairs.find((outcome) => outcome.strategy === "regenerate-variant" && outcome.location.entityId === vanishedId);
    expect(attempted?.succeeded).toBe(false);
    expect(attempted!.detail).toContain("original is missing from storage");

    // And the run was filed, with its findings, so a release can be compared with the last one.
    expect(report.runId).toBeTruthy();
    const stored = await db.query.qcRuns.findFirst({ where: eq(s.qcRuns.id, report.runId!) });
    expect(stored?.specVersion).toBe(QC_SPEC_VERSION);
    expect(stored?.profile).toBe("PRINT");
    const findings = await db.select().from(s.qcFindings).where(eq(s.qcFindings.runId, report.runId!));
    expect(findings.length).toBeGreaterThan(0);
    const filed = findings.find((row) => row.metricId === "rights.cleared");
    expect(filed?.expected).toBe("GREEN or YELLOW");
    expect(filed?.actual).toBe("RED");
    expect(filed?.severity).toBe("HARD_FAIL");
  }, 240_000);

  it("refuses to let the issue publish while a blocking defect survives", async () => {
    // Refused rights cannot be repaired by software: somebody has to clear them or take the
    // picture out. So this is the one that is still there after the loop, and it must block.
    const error = await requireQcPass(editionId, { profile: "PRINT", only: ["rights"], persist: false }).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(QcBlockedError);
    expect((error as QcBlockedError).message).toContain("rights are refused");
    expect((error as QcBlockedError).report.ok).toBe(false);
  }, 120_000);

  it("passes once the defect is actually fixed, measured again by the same code", async () => {
    await db.update(s.mediaAssets).set({ rightsStatus: "GREEN" }).where(eq(s.mediaAssets.id, refusedId));
    const report = await runQc(editionId, { profile: "PRINT", only: ["rights"], repair: false, persist: false });
    expect(find(report, "rights.cleared", refusedId)).toBeUndefined();
    expect(report.passed.some((each) => each.metricId === "rights.cleared")).toBe(true);
  }, 120_000);

  it("records a check that could not run as skipped, never as passed", async () => {
    // A check that throws has not found anything; saying so is the difference between a quality
    // system and a green light.
    const { registerCheck, registeredChecks } = await import("@/server/qc/engine");
    const original = registeredChecks().find((check) => check.id === "providers")!;
    registerCheck({ id: "providers", title: original.title, run: async () => { throw new Error("deliberately broken check"); } });
    try {
      const report = await runQc(editionId, { only: ["providers"], repair: false, persist: false });
      expect(report.status).toBe("ERRORED");
      expect(report.skipped).toEqual([{ check: "providers", reason: "deliberately broken check" }]);
      expect(report.ok, "an errored run is not an ok run").toBe(false);
      expect(report.passed).toEqual([]);
    } finally {
      registerCheck(original);
    }
  }, 60_000);
});
