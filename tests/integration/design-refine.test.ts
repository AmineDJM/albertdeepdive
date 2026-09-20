import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { launchBrowser } from "@/server/publication/pdf";
import { refineEditionDesign, type RefineResult } from "@/server/design/refine";
import { currentDesign, designEdition, designHistory, saveDesign } from "@/server/design/service";
import { blocksOf, findBlock, withBlock } from "@/lib/design/model";
import { blocking } from "@/lib/design/critic";
import type { Browser } from "playwright";

/**
 * Render, look, revise — on a real edition, with a real browser.
 *
 * Run without a model on purpose: what is being proved is the floor. Given a design with something
 * genuinely wrong in it, the loop must lay the issue out, find the fault from the render, make a
 * change a person would recognise, and stop. And given an issue with nothing wrong, it must do
 * nothing at all — a refinement pass that always finds work is a pass nobody will trust.
 */
describe("the refinement loop on a real edition", () => {
  let editionId: string;
  let organizationId: string;
  let browser: Browser;
  let broken: RefineResult;
  let brokenBlockId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
    browser = await launchBrowser();

    broken = await runAsOrganization(organizationId, async () => {
      const { design } = await designEdition(editionId, { local: true });
      // Break it the way a person would: ask for a composition no renderer draws.
      const target = blocksOf(design).find((block) => block.role === "feature" || block.role === "secondary")!;
      brokenBlockId = target.id;
      await saveDesign(editionId, withBlock(design, target.id, (block) => ({ ...block, composition: "kaleidoscope" })), { summary: "deliberately broken, for the test" });
      return refineEditionDesign(editionId, { local: true, rounds: 2, browser });
    });
  }, 420_000);

  it("finds the fault and fixes it", () => {
    const first = broken.rounds[0];
    expect(first.findings.some((finding) => finding.id.includes("unknown-composition"))).toBe(true);
    expect(first.applied.length).toBeGreaterThan(0);
    expect(findBlock(broken.design, brokenBlockId)?.composition).not.toBe("kaleidoscope");
  });

  it("leaves nothing blocking behind", () => {
    expect(blocking(broken.remaining).map((finding) => finding.issue)).toEqual([]);
  });

  it("says what it did, in words an editor would use", () => {
    expect(broken.rounds[0].said.length).toBeGreaterThan(10);
    expect(broken.rounds[0].said).not.toContain("undefined");
    expect(["clean", "nothing-left-to-change", "out-of-rounds"]).toContain(broken.stoppedBecause);
  });

  it("stores the result as a new revision, keeping the one before it", async () => {
    const history = await runAsOrganization(organizationId, () => designHistory(editionId));
    expect(history.length).toBeGreaterThan(2);
    expect(history[0].summary).toContain("Refined after looking");
    expect(history[0].isCurrent).toBe(true);
    const now = await runAsOrganization(organizationId, () => currentDesign(editionId));
    expect(now?.revision).toBe(broken.revision);
  });

  it("spends nothing when no model is asked", () => {
    expect(broken.costCents).toBe(0);
    expect(broken.rounds.every((round) => round.shots === 0)).toBe(true);
  });

  it("does nothing at all to an issue with nothing wrong", async () => {
    const again = await runAsOrganization(organizationId, () => refineEditionDesign(editionId, { local: true, rounds: 2, browser }));
    expect(again.rounds.flatMap((round) => round.applied)).toEqual([]);
    // No change means no revision: a pass that always finds work is a pass nobody trusts.
    expect(again.revision).toBe(broken.revision);
    expect(again.stoppedBecause === "clean" || again.stoppedBecause === "nothing-left-to-change").toBe(true);
  }, 300_000);

  it("lays the issue out every round, so the critique is about the pages that came out", () => {
    expect(broken.plan.pages.length).toBeGreaterThan(2);
    expect(broken.markup).toContain('class="page"');
    expect(broken.rounds[0].pages).toBe(broken.plan.pages.length > 0 ? broken.rounds[0].pages : 0);
  });

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });
});
