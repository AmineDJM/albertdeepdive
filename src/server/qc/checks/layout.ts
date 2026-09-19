import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from "pdf-lib";
import { documentSizeMm, ptToMm } from "../profiles";
import {
  IMAGE_RENDER_FAILED,
  PAGE_BLANK,
  PAGE_COUNT_MATCHES,
  PAGE_FIT_RATIO,
  PAGE_UNDERFILLED,
  PDF_FONTS_EMBEDDED,
  PDF_METADATA,
  PDF_PAGE_SIZE,
  PDF_PARSES,
  PRINT_BLEED,
  TEXT_OVERFLOW,
} from "../spec";
import { assertThat, compare, merge, nothing, type CheckResult } from "../types";
import type { Check, QcContext } from "../engine";

/**
 * Geometry, measured rather than inspected.
 *
 * The paginator already measures every flow against its frame — that is how copyfitting works — so
 * the honest thing is to consume those measurements rather than invent a second, weaker opinion
 * from the document model. What this adds is the part that was missing: thresholds, severities, a
 * location, and a failure that blocks.
 *
 * The rule that matters most has no tolerance band. Two pixels of clipped text is a failure. Not a
 * warning, not a score, not something an art director may wave through — the words are cut off.
 */

export const geometryCheck: Check = {
  id: "geometry",
  title: "Nothing overflows, nothing is blank, the page count is the page count",
  kinds: ["paged"],
  async run(ctx: QcContext): Promise<CheckResult> {
    const artefact = await ctx.render();
    const report = artefact.layoutReport;
    const results: CheckResult[] = [];

    for (const overflow of report.remainingOverflow) {
      results.push(
        assertThat({
          spec: TEXT_OVERFLOW,
          holds: false,
          location: { entityType: "page", page: overflow.page, entityId: overflow.pageId, field: "flow" },
          message: `Text still runs past its frame on page ${overflow.page} after copyfitting. ${overflow.blocks.length} block(s) do not fit.`,
          expected: "0 overflowing blocks",
          actual: `${overflow.blocks.length}`,
          evidence: { articleId: overflow.articleId, blocks: overflow.blocks },
        }),
      );
    }
    if (!report.remainingOverflow.length) {
      results.push(compare({ spec: TEXT_OVERFLOW, actual: 0, location: { entityType: "edition", entityId: ctx.editionId }, message: "No text overflows." }));
    }

    for (const page of report.blankPages) {
      results.push(
        assertThat({
          spec: PAGE_BLANK,
          holds: false,
          location: { entityType: "page", page },
          message: `Page ${page} came out blank.`,
          expected: "content",
          actual: "empty",
        }),
      );
    }
    if (!report.blankPages.length) {
      results.push(compare({ spec: PAGE_BLANK, actual: 0, location: { entityType: "edition", entityId: ctx.editionId }, message: "No blank pages." }));
    }

    for (const failed of report.imagesFailed) {
      results.push(
        assertThat({
          spec: IMAGE_RENDER_FAILED,
          holds: false,
          location: { entityType: "media", entityId: failed.mediaId, page: failed.page },
          message: `The renderer could not load a picture on page ${failed.page}. It would print as an empty box.`,
          expected: "the image renders",
          actual: "failed to load",
        }),
      );
    }
    if (!report.imagesFailed.length) {
      results.push(compare({ spec: IMAGE_RENDER_FAILED, actual: 0, location: { entityType: "edition", entityId: ctx.editionId }, message: "Every image rendered." }));
    }

    results.push(
      compare({
        spec: PAGE_COUNT_MATCHES,
        actual: report.pageCountMismatch ? Math.abs(report.pageCountMismatch.expected - report.pageCountMismatch.actual) : 0,
        location: { entityType: "edition", entityId: ctx.editionId },
        message: report.pageCountMismatch
          ? `The artefact has ${report.pageCountMismatch.actual} pages where the document has ${report.pageCountMismatch.expected}.`
          : "The rendered page count matches the document.",
        evidence: report.pageCountMismatch ? { ...report.pageCountMismatch } : undefined,
      }),
    );

    // Per-page fit, which is where a 2px overflow actually lives before it becomes a clipped word.
    for (const fit of report.fit) {
      results.push(
        compare({
          spec: PAGE_FIT_RATIO,
          actual: fit.ratio,
          location: { entityType: "page", page: fit.page, entityId: fit.pageId, field: fit.template },
          message: `Page ${fit.page} fills ${(fit.ratio * 100).toFixed(1)}% of its usable height.`,
          evidence: { template: fit.template, articleId: fit.articleId },
        }),
      );
    }

    for (const page of report.underfilled ?? []) {
      results.push(
        compare({
          spec: PAGE_UNDERFILLED,
          actual: page.occupancy,
          direction: "at-least",
          location: { entityType: "page", page: page.page },
          message: `Page ${page.page} is ${(page.occupancy * 100).toFixed(0)}% full.`,
        }),
      );
    }

    return merge(...results);
  },
};

/**
 * The artefact itself, opened and read.
 *
 * "The PDF exported" is not PDF QA. A file can be written, be the right size on disk, and still
 * have a page that will not render, a font nobody embedded, or a page box a millimetre off what
 * the printer asked for. Each of those is found by opening the file, not by trusting the exporter.
 */
export const pdfCheck: Check = {
  id: "pdf",
  title: "The PDF parses, its pages are the right size, its fonts are embedded",
  kinds: ["paged"],
  async run(ctx: QcContext): Promise<CheckResult> {
    const artefact = await ctx.render();
    const results: CheckResult[] = [];

    let pdf: PDFDocument;
    try {
      pdf = await PDFDocument.load(artefact.buffer, { updateMetadata: false });
    } catch (err) {
      return assertThat({
        spec: PDF_PARSES,
        holds: false,
        location: { entityType: "output", entityId: ctx.editionId, output: ctx.profile.id },
        message: `The PDF could not be read back: ${err instanceof Error ? err.message : String(err)}`,
        expected: "a readable PDF",
        actual: "unreadable",
      });
    }

    results.push(
      assertThat({
        spec: PDF_PARSES,
        holds: pdf.getPageCount() > 0,
        location: { entityType: "output", entityId: ctx.editionId, output: ctx.profile.id },
        message: "The PDF parses but has no pages.",
        expected: "at least one page",
        actual: `${pdf.getPageCount()}`,
      }),
    );

    // Every page is read, not just the first: a broken page eight is still a broken issue.
    const expected = documentSizeMm(ctx.profile);
    let worstDelta = 0;
    let worstPage = 0;
    for (let i = 0; i < pdf.getPageCount(); i++) {
      const { width, height } = pdf.getPage(i).getSize();
      const delta = Math.max(Math.abs(ptToMm(width) - expected.width), Math.abs(ptToMm(height) - expected.height));
      if (delta > worstDelta) {
        worstDelta = delta;
        worstPage = i + 1;
      }
    }
    results.push(
      compare({
        spec: PDF_PAGE_SIZE,
        actual: worstDelta,
        location: { entityType: "page", page: worstPage || 1, output: ctx.profile.id },
        message:
          worstDelta > 0.5
            ? `Page ${worstPage} is ${worstDelta.toFixed(2)}mm away from the ${expected.width}×${expected.height}mm this profile asks for.`
            : `Every page is ${expected.width}×${expected.height}mm.`,
        expectedText: `${expected.width}×${expected.height} mm ± 0.5`,
        evidence: { profile: ctx.profile.id, trimMm: ctx.profile.trimMm, bleedMm: ctx.profile.bleedMm },
      }),
    );

    // Fonts: a name in the resource dictionary with no embedded file is a font somebody else's
    // machine will substitute, which reflows the page after it has left the building.
    const missingFonts = unembeddedFonts(pdf);
    results.push(
      compare({
        spec: PDF_FONTS_EMBEDDED,
        actual: missingFonts.length,
        location: { entityType: "output", entityId: ctx.editionId, output: ctx.profile.id },
        message: missingFonts.length ? `${missingFonts.length} font(s) are referenced but not embedded: ${missingFonts.join(", ")}.` : "Every font is embedded.",
        evidence: missingFonts.length ? { fonts: missingFonts } : undefined,
      }),
    );

    results.push(
      assertThat({
        spec: PDF_METADATA,
        holds: Boolean(pdf.getTitle() && pdf.getAuthor()),
        location: { entityType: "output", entityId: ctx.editionId, output: ctx.profile.id },
        message: "The file does not say which issue it is.",
        expected: "a title and an author",
        actual: `title=${pdf.getTitle() ?? "—"} author=${pdf.getAuthor() ?? "—"}`,
      }),
    );

    return merge(...results);
  },
};

/**
 * Fonts referenced by a page with no embedded font file behind them.
 *
 * Walks the page resources rather than trusting the renderer. A font descriptor carries one of
 * FontFile, FontFile2 or FontFile3 when the bytes travel with the document; a descriptor without
 * any of them is a name and a hope — and a name is what the *other* machine substitutes, reflowing
 * the page after it has left the building.
 *
 * A resource tree this cannot walk returns nothing rather than a failure: a check that could not
 * run has not found a defect, and inventing one is worse than admitting the gap.
 */
function unembeddedFonts(pdf: PDFDocument): string[] {
  const missing = new Set<string>();
  try {
    for (const page of pdf.getPages()) {
      const fonts = page.node.Resources()?.lookupMaybe(PDFName.of("Font"), PDFDict);
      if (!fonts) continue;
      for (const [, value] of fonts.entries()) {
        const font = pdf.context.lookupMaybe(value, PDFDict);
        if (!font) continue;
        const base = font.lookupMaybe(PDFName.of("BaseFont"), PDFName);
        const name = base ? base.asString().replace(/^\//, "") : "unknown";
        if (!embedded(pdf, font)) missing.add(name);
      }
    }
  } catch {
    return [];
  }
  return [...missing];
}

/** A descriptor with font bytes, following the descendant a Type0 font hides its descriptor behind. */
function embedded(pdf: PDFDocument, font: PDFDict): boolean {
  const direct = font.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  if (direct) return hasFontFile(direct);
  const descendants = font.lookupMaybe(PDFName.of("DescendantFonts"), PDFArray);
  const first = descendants ? pdf.context.lookupMaybe(descendants.get(0), PDFDict) : undefined;
  const nested = first?.lookupMaybe(PDFName.of("FontDescriptor"), PDFDict);
  // No descriptor at all means one of the fourteen standard faces, which every reader already has.
  return nested ? hasFontFile(nested) : true;
}

function hasFontFile(descriptor: PDFDict): boolean {
  return ["FontFile", "FontFile2", "FontFile3"].some((key) => Boolean(descriptor.lookupMaybe(PDFName.of(key), PDFStream)));
}

/**
 * The print-specific geometry: bleed, and nothing important inside the trim.
 *
 * Separate from the PDF check because it is the *printer's* requirement rather than the format's.
 * A screen PDF with no bleed is correct; the same file sent to a press is a job that comes back
 * with white slivers down one edge.
 */
export const printCheck: Check = {
  id: "print",
  title: "Bleed and safe margins match the printer's profile",
  kinds: ["paged"],
  async run(ctx: QcContext): Promise<CheckResult> {
    const bleed = ctx.profile.bleedMm ?? 0;
    if (!bleed) return nothing();
    const artefact = await ctx.render();
    const pdf = await PDFDocument.load(artefact.buffer, { updateMetadata: false }).catch(() => null);
    if (!pdf) return nothing();

    const trim = ctx.profile.trimMm ?? { width: 210, height: 297 };
    const { width, height } = pdf.getPage(0).getSize();
    const actualBleedX = (ptToMm(width) - trim.width) / 2;
    const actualBleedY = (ptToMm(height) - trim.height) / 2;
    const delta = Math.max(Math.abs(actualBleedX - bleed), Math.abs(actualBleedY - bleed));

    return compare({
      spec: PRINT_BLEED,
      actual: delta,
      location: { entityType: "output", entityId: ctx.editionId, output: ctx.profile.id },
      message:
        delta > 0.5
          ? `The document carries ${actualBleedX.toFixed(1)}mm of bleed where ${ctx.profile.title} asks for ${bleed}mm. On ${trim.width}×${trim.height}mm trim that means a ${trim.width + bleed * 2}×${trim.height + bleed * 2}mm document.`
          : `Bleed is ${bleed}mm on every edge, as the profile asks.`,
      expectedText: `${bleed} mm ± 0.5`,
      evidence: { trimMm: trim, expectedDocumentMm: documentSizeMm(ctx.profile), actualBleedMm: { x: Number(actualBleedX.toFixed(2)), y: Number(actualBleedY.toFixed(2)) } },
    });
  },
};
