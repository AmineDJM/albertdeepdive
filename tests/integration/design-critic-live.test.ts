import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { launchBrowser } from "@/server/publication/pdf";
import { printEditionDesign } from "@/server/design/print";
import { pagesWorthSeeing, shootPages } from "@/server/design/shots";
import { critiqueLayout, seenFindings } from "@/server/ai/services/layout-critic";
import { blocksOf } from "@/lib/design/model";
import { DIMENSIONS } from "@/lib/design/critic";

/**
 * The critic actually looking, against a real model.
 *
 * §34 says the agent must see the actual render, and a vision path that has never run is a claim
 * rather than a capability. This renders a real edition, screenshots real pages and sends them, so
 * the thing being checked is the whole road: the shot, the request, the strict schema, and the
 * boundary that turns the answer into findings about blocks that exist.
 *
 * Skipped where no model is configured — which is most places, and is why everything else in the
 * engine works without one.
 */
const live = process.env.AI_PROVIDER === "openai";

describe.skipIf(!live)("the layout critic, looking at real pages", () => {
  let shots: Awaited<ReturnType<typeof shootPages>>;
  let blockIds: Set<string>;
  let roleOf: Map<string, string>;
  let pages: Set<number>;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, seeded.editionId) });
    const browser = await launchBrowser();
    try {
      const printed = await runAsOrganization(edition!.organizationId!, () => printEditionDesign(seeded.editionId, { local: true, browser }));
      shots = await shootPages(printed.markup, pagesWorthSeeing(printed.plan, printed.measures, 3), { browser });
      const blocks = blocksOf(printed.design);
      blockIds = new Set(blocks.map((block) => block.id));
      roleOf = new Map(blocks.map((block) => [block.id, block.role]));
      pages = new Set(printed.plan.pages.map((page) => page.number));
    } finally {
      await browser.close().catch(() => {});
    }
  }, 600_000);

  it("takes real pictures of the pages", () => {
    expect(shots.length).toBeGreaterThan(0);
    for (const shot of shots) {
      // A PNG, not an empty buffer or an error page.
      expect(shot.png.subarray(0, 4).toString("hex")).toBe("89504e47");
      expect(shot.png.length).toBeGreaterThan(5_000);
    }
  });

  it("answers about the issue in front of it, inside the schema", async () => {
    const result = await critiqueLayout({
      shots: shots.map((shot) => ({ label: shot.label, png: shot.png })),
      intent: "A monthly business school review: serious, photographic, unhurried.",
      blocks: [...blockIds].slice(0, 40).map((id) => ({ id, role: roleOf.get(id) ?? "feature", composition: "two-column", importance: "STANDARD", headline: null })),
      alreadyKnown: [],
    });

    expect(result, "no critique came back from the model").not.toBeNull();
    // Printed because this only ever runs deliberately, and because the point of the test is what
    // the model actually said about real pages.
    console.log(`[critic] ${result!.critique.verdict}: ${result!.critique.summary}`);
    for (const finding of result!.critique.findings) console.log(`[critic] ${finding.severity} ${finding.dimension} @ ${finding.where}: ${finding.issue}`);
    expect(["excellent", "competent", "generic", "broken"]).toContain(result!.critique.verdict);
    expect(result!.critique.summary.length).toBeGreaterThan(10);
    for (const finding of result!.critique.findings) {
      expect(DIMENSIONS).toContain(finding.dimension);
      expect(finding.issue.length).toBeGreaterThan(4);
    }
    expect(result!.inputTokens).toBeGreaterThan(0);

    // And everything it said is checked against what exists before anything acts on it.
    const findings = seenFindings(result!.critique, { blockIds, roleOf, pages });
    for (const finding of findings) {
      if (finding.blockId) expect(blockIds.has(finding.blockId)).toBe(true);
      if (finding.page) expect(pages.has(finding.page)).toBe(true);
      if (finding.remedy.kind === "composition") expect(blockIds.has(finding.remedy.blockId)).toBe(true);
    }
  }, 300_000);
});
