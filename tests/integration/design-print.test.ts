import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { launchBrowser } from "@/server/publication/pdf";
import { printEditionDesign, type PrintedEdition } from "@/server/design/print";

/**
 * The design, printed on a real edition by a real browser.
 *
 * Everything else about the design engine can be argued about. This cannot: either the pages come
 * out with nothing spilling off them, in the right order, with folios that agree with the contents,
 * or the engine does not work. It runs without a model on purpose — what is being proved is the
 * floor, which is what a customer gets when nothing is connected.
 */
describe("printing a real edition from its design", () => {
  let printed: PrintedEdition;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, seeded.editionId) });
    const browser = await launchBrowser();
    try {
      printed = await runAsOrganization(edition!.organizationId!, () => printEditionDesign(seeded.editionId, { local: true, browser }));
    } finally {
      await browser.close();
    }
  }, 420_000);

  it("settles with nothing spilling off a page", () => {
    expect(printed.report.overflowing).toEqual([]);
    expect(printed.report.settled).toBe(true);
    // It took work: a real issue does not fall onto pages first time.
    expect(printed.report.rounds).toBeGreaterThan(1);
  });

  it("prints a PDF whose page count is the plan's", () => {
    expect(printed.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(printed.pageCount).toBe(printed.plan.pages.length);
    expect(printed.pageCount).toBeGreaterThan(2);
  });

  it("keeps the design's promises about what may not be broken", () => {
    expect(printed.integrity.brokenAtomic).toEqual([]);
    expect(printed.integrity.missingSurfaces).toEqual([]);
    // A cover is page one, and it is never continued.
    expect(printed.plan.pages[0].surfaces[0]?.kind).toBe("cover");
    expect(printed.plan.pages[0].number).toBe(1);
  });

  it("numbers the pages once, in order, with the folio the plan believes", () => {
    const numbers = printed.plan.pages.map((page) => page.number);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    const printedFolios = [...printed.markup.matchAll(/<span class="number">(\d+)<\/span>/g)].map((match) => Number(match[1]));
    // Every folio drawn is a page number in the plan, and no page carries two.
    expect(new Set(printedFolios).size).toBe(printedFolios.length);
    for (const folio of printedFolios) expect(numbers).toContain(folio);
  });

  it("puts every story in the issue on a page", () => {
    const placed = new Set(Object.keys(printed.plan.pageOfArticle));
    const designed = new Set(
      printed.design.sections
        .flatMap((section) => section.surfaces)
        .flatMap((surface) => surface.blocks)
        .map((block) => block.articleId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const articleId of designed) expect(placed.has(articleId), `${articleId} was designed but never placed`).toBe(true);
  });

  it("writes down every place it overruled the design", () => {
    const blocks = new Set(
      printed.plan.pages.flatMap((page) => page.surfaces.flatMap((surface) => surface.blocks.map((block) => block.id))),
    );
    for (const relaxation of printed.plan.relaxations) {
      // A relaxation names a block that is still in the issue, and says why in words.
      expect(blocks.has(relaxation.blockId), `${relaxation.blockId} was moved off a page and then lost`).toBe(true);
      expect(relaxation.reason.length).toBeGreaterThan(10);
      expect(relaxation.fromPage).toBeGreaterThan(0);
    }
  });

  it("says what it did in words an editor would use", () => {
    expect(printed.summary).toMatch(/\d+ pages on A4/);
  });
});
