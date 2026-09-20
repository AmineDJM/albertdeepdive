import type { Browser } from "playwright";
import { withBrowser } from "@/server/publication/pdf";
import type { OutputMedium } from "@/lib/design/roles";
import type { PrintPlan } from "@/lib/design/pages";

/**
 * The render, as something that can be looked at.
 *
 * §34 of the design brief is not negotiable: the agent must see the actual render. Measurements say
 * a page is 94 % full; they cannot say it is ugly, that the photograph is cropped through somebody's
 * chin, or that three pages in a row look like the same page. That needs eyes, and eyes need
 * pictures.
 *
 * What is shot is chosen rather than exhaustive. A thirty-page issue is thirty screenshots, most of
 * which say the same thing; an art director asked to look at an issue looks at the cover, the
 * opener, the fullest page and the emptiest one. That is what this picks, and it is why the cost of
 * looking stays roughly constant as an edition grows.
 */

export type Shot = {
  /** What this is a picture of, in words: "page 1, the cover". Sent to the model with the image. */
  label: string;
  medium: OutputMedium;
  page: number | null;
  width: number;
  png: Buffer;
};

export type ShotOptions = { browser?: Browser; scale?: number };

/**
 * The pages worth looking at.
 *
 * Deterministic on purpose — the same design gives the same shots, so two runs of the critic are
 * comparable and a golden test is possible.
 */
export function pagesWorthSeeing(plan: PrintPlan, measures: { number: number; extent: number; tailGap: number }[], limit = 5): number[] {
  const printed = plan.pages.filter((page) => !page.blank);
  if (!printed.length) return [];
  const chosen = new Set<number>();
  chosen.add(printed[0].number);

  const opener = printed.find((page) => page.surfaces.some((surface) => surface.kind === "opener"));
  if (opener) chosen.add(opener.number);

  const byExtent = [...measures].filter((measure) => plan.pages.some((page) => page.number === measure.number && !page.blank)).sort((a, b) => b.extent - a.extent);
  if (byExtent.length) {
    chosen.add(byExtent[0].number);
    chosen.add(byExtent[byExtent.length - 1].number);
  }
  // Something from the middle of the issue, which is where a publication either has a rhythm or
  // reveals that it does not.
  chosen.add(printed[Math.floor(printed.length / 2)].number);

  return [...chosen].filter((number) => Number.isFinite(number)).sort((a, b) => a - b).slice(0, limit);
}

/** Printed pages, one image each, from the same HTML the PDF was printed from. */
export async function shootPages(markup: string, pages: number[], options: ShotOptions = {}): Promise<Shot[]> {
  if (!pages.length) return [];
  return withBrowser(async (browser) => {
    const context = await browser.newContext({ viewport: { width: 1240, height: 1754 }, deviceScaleFactor: options.scale ?? 1 });
    const page = await context.newPage();
    try {
      await page.emulateMedia({ media: "print" });
      await page.setContent(markup, { waitUntil: "load", timeout: 180_000 });
      await page.evaluate(() => document.fonts.ready);
      const shots: Shot[] = [];
      for (const number of pages) {
        const target = page.locator(`.page[data-number="${number}"]`).first();
        if (!(await target.count())) continue;
        await target.scrollIntoViewIfNeeded();
        const kind = await target.getAttribute("data-kind");
        shots.push({ label: `page ${number}${kind && kind !== "flow" ? `, the ${kind}` : ""}`, medium: "print", page: number, width: 1240, png: await target.screenshot({ type: "png" }) });
      }
      return shots;
    } finally {
      await context.close().catch(() => {});
    }
  }, options.browser);
}

/**
 * A scrolling document — the web edition or an email — at the widths it is actually read at.
 *
 * Clipped rather than full-page: a thirty-page issue's web edition is one image thirty thousand
 * pixels tall, which no model can see and nobody would look at. The top of the page is where a
 * design either works or does not.
 */
export async function shootDocument(html: string, options: ShotOptions & { medium: OutputMedium; widths: number[]; maxHeight?: number }): Promise<Shot[]> {
  return withBrowser(async (browser) => {
    const shots: Shot[] = [];
    for (const width of options.widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: options.scale ?? 1 });
      const page = await context.newPage();
      try {
        await page.setContent(html, { waitUntil: "load", timeout: 180_000 });
        await page.evaluate(() => document.fonts.ready);
        const height = Math.min(options.maxHeight ?? 2400, await page.evaluate(() => document.body.scrollHeight));
        shots.push({
          label: `${options.medium} at ${width}px${width <= 420 ? ", on a phone" : ""}`,
          medium: options.medium,
          page: null,
          width,
          png: await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height: Math.max(200, height) } }),
        });
      } finally {
        await context.close().catch(() => {});
      }
    }
    return shots;
  }, options.browser);
}

/** Total bytes of a set of shots, because looking is billed by the picture. */
export function weightOf(shots: readonly Shot[]): number {
  return shots.reduce((total, shot) => total + shot.png.length, 0);
}
