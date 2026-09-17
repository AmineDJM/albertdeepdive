import { templateByCode } from "@/lib/constants";
import type { EditionDocument } from "@/lib/publication/document";
import { DENSITY, LOOSE_ALLOWED, SPARSE_BY_DESIGN } from "@/lib/publication/layout-rules";
import type { PageMeasurement } from "./paginate";
import { CONTINUATION_TEMPLATE } from "./paginate";

/**
 * Page-level quality control for the printed issue.
 *
 * The layout engine measures geometry (`PageMeasurement`); this module turns that into an editorial
 * verdict: is this a page a magazine art director would sign off? It separates HARD failures, which
 * must trigger a re-layout before the issue can be exported (overflow, clipped or blank pages, a
 * continuation page that does not earn its paper), from SOFT warnings, which only ask for a look
 * (slightly loose page, a repeated template run, a widow).
 *
 * Deliberately sparse pages — the cover, a section opener, a full-bleed quote page — are exempt from
 * the density rules: whitespace there is a decision, not an accident.
 */

/** The engine composes against exactly these numbers (see `@/lib/publication/layout-rules`). */
export const QUALITY_THRESHOLDS = {
  targetOccupancy: DENSITY.targetOccupancy,
  hardOccupancyFloor: DENSITY.hardOccupancyFloor,
  softFlowFill: DENSITY.softFlowFill,
  hardFlowFill: DENSITY.hardFlowFill,
  hardContinuationFill: DENSITY.continuationFloor,
  softTailGap: DENSITY.softTailGap,
  hardTailGap: DENSITY.hardTailGap,
  repeatedTemplateRun: DENSITY.repeatedTemplateRun,
} as const;

export type QualitySeverity = "error" | "warning";
export type PageIssue = { code: string; severity: QualitySeverity; message: string };

export type PageQualityReport = {
  pageNumber: number;
  pageId: string;
  template: string;
  family: string;
  isContinuation: boolean;
  /** Share of the usable editorial area (`.sheet`) carrying ink. */
  usableAreaOccupancy: number;
  emptySpaceRatio: number;
  tailGapRatio: number;
  /** Lowest fill across the page's text flows (1 = every column full). */
  minFlowFill: number | null;
  overflowCount: number;
  orphanCount: number;
  widowCount: number;
  imageCount: number;
  imagesFailed: string[];
  repeatedImages: string[];
  blank: boolean;
  issues: PageIssue[];
  hardFail: boolean;
};

export type IssueQualityReport = {
  ok: boolean;
  pages: PageQualityReport[];
  totalPages: number;
  hardFailures: number;
  softWarnings: number;
  averageOccupancy: number;
  /** Pages that must be recomposed before export. */
  failingPages: number[];
  /** Pages worth a second look. */
  weakPages: number[];
  overflowPages: number[];
  issueCounts: Record<string, number>;
};

function familyOf(template: string): string {
  if (template === CONTINUATION_TEMPLATE) return "continuation";
  try {
    return templateByCode(template).family;
  } catch {
    return "article";
  }
}

/** Media ids placed more than once across the issue — a photo should rarely appear twice. */
function repeatedMediaIds(doc: EditionDocument): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string | null | undefined) => {
    if (!id) return;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  };
  for (const page of doc.pages) for (const id of page.mediaIds) bump(id);
  for (const article of doc.articles) for (const block of article.body) if (block.type === "image") bump(block.assetId);
  return counts;
}

export function analyzePages(doc: EditionDocument, measures: PageMeasurement[]): IssueQualityReport {
  const pageById = new Map(doc.pages.map((p) => [p.id, p]));
  const mediaById = new Map(doc.media.map((m) => [m.id, m]));
  const repeats = repeatedMediaIds(doc);
  const reports: PageQualityReport[] = [];

  for (const [index, measure] of measures.entries()) {
    const page = pageById.get(measure.pageId);
    const template = measure.template || page?.template || "";
    const family = familyOf(template);
    const isContinuation = template === CONTINUATION_TEMPLATE || page?.isContinuation === true;
    const sparseByDesign = SPARSE_BY_DESIGN.has(template);
    const looseAllowed = LOOSE_ALLOWED.has(template);
    const issues: PageIssue[] = [];

    const occupancy = measure.density?.occupancy ?? 0;
    const tailGap = measure.density?.tailGapRatio ?? 0;
    const textFlows = measure.flows;
    const minFlowFill = textFlows.length ? Math.min(...textFlows.map((f) => f.fillRatio)) : null;
    const overflowCount = textFlows.filter((f) => f.overflow).length;
    const orphanCount = textFlows.reduce((n, f) => n + f.orphans, 0);
    const widowCount = textFlows.reduce((n, f) => n + f.widows, 0);

    // ── hard failures: the issue cannot be exported like this ──
    if (overflowCount > 0) {
      issues.push({ code: "OVERFLOW", severity: "error", message: `${overflowCount} text area(s) overflow — content would be clipped.` });
    }
    if (measure.blank) {
      issues.push({ code: "BLANK_PAGE", severity: "error", message: "The page carries no content." });
    }
    if (measure.imagesFailed.length) {
      issues.push({ code: "IMAGE_FAILED", severity: "error", message: `${measure.imagesFailed.length} image(s) failed to load.` });
    }
    // A continuation's flow uses `column-fill: balance` and shrinks to its own content, so its fill
    // ratio reads 100 % even on a page that is three-quarters empty. Occupancy is the honest signal.
    if (isContinuation && occupancy < QUALITY_THRESHOLDS.hardContinuationFill) {
      issues.push({
        code: "SPARSE_CONTINUATION",
        severity: "error",
        message: `Continuation page only ${Math.round(occupancy * 100)} % full (${Math.round(tailGap * 100)} % empty at the foot) — it does not earn a page.`,
      });
    }
    if (!sparseByDesign && !isContinuation && !looseAllowed) {
      if (occupancy < QUALITY_THRESHOLDS.hardOccupancyFloor && tailGap > QUALITY_THRESHOLDS.hardTailGap) {
        issues.push({
          code: "UNDERFULL_PAGE",
          severity: "error",
          message: `Only ${Math.round(occupancy * 100)} % of the page is used, with ${Math.round(tailGap * 100)} % empty at the foot.`,
        });
      }
      if (minFlowFill !== null && minFlowFill < QUALITY_THRESHOLDS.hardFlowFill) {
        issues.push({ code: "UNDERSET_FLOW", severity: "error", message: `A text area is only ${Math.round(minFlowFill * 100)} % set.` });
      }
    }

    // ── soft warnings ──
    // Occupancy alone does not convict a page: ink never covers the whole sheet, because gutters,
    // leading and grid gaps are part of good typography. A page is only "loose" when the space it
    // leaves is actually reclaimable — a gap at the foot, or columns that stop short.
    const reclaimable = tailGap > QUALITY_THRESHOLDS.softTailGap || (minFlowFill !== null && minFlowFill < QUALITY_THRESHOLDS.softFlowFill);
    if (!sparseByDesign && occupancy < QUALITY_THRESHOLDS.targetOccupancy.min && reclaimable && !issues.some((i) => i.code === "UNDERFULL_PAGE")) {
      issues.push({ code: "LOOSE_PAGE", severity: "warning", message: `${Math.round(occupancy * 100)} % of the usable area is used, and ${Math.round(tailGap * 100)} % is reclaimable.` });
    }
    if (!sparseByDesign && tailGap > QUALITY_THRESHOLDS.softTailGap && tailGap <= QUALITY_THRESHOLDS.hardTailGap) {
      issues.push({ code: "TAIL_GAP", severity: "warning", message: `${Math.round(tailGap * 100)} % of the page is empty below the last element.` });
    }
    if (minFlowFill !== null && minFlowFill < QUALITY_THRESHOLDS.softFlowFill && minFlowFill >= QUALITY_THRESHOLDS.hardFlowFill) {
      issues.push({ code: "LOOSE_FLOW", severity: "warning", message: `A text area is ${Math.round(minFlowFill * 100)} % set.` });
    }
    if (orphanCount) issues.push({ code: "ORPHAN", severity: "warning", message: `${orphanCount} orphan line(s) at a column foot.` });
    if (widowCount) issues.push({ code: "WIDOW", severity: "warning", message: `${widowCount} widow line(s) at a column head.` });

    // repeated template run (looks machine-made)
    const run = (() => {
      let n = 1;
      for (let i = index - 1; i >= 0 && measures[i].template === template; i -= 1) n += 1;
      return n;
    })();
    if (run >= QUALITY_THRESHOLDS.repeatedTemplateRun && family !== "continuation") {
      issues.push({ code: "REPEATED_TEMPLATE", severity: "warning", message: `${run}th “${template}” page in a row — vary the composition.` });
    }

    // image quality + reuse
    const pageMedia = page?.mediaIds ?? [];
    const repeatedImages = pageMedia.filter((id) => (repeats.get(id) ?? 0) > 1);
    if (repeatedImages.length) {
      issues.push({ code: "REPEATED_IMAGE", severity: "warning", message: `${repeatedImages.length} image(s) also used elsewhere in the issue.` });
    }
    for (const id of pageMedia) {
      const media = mediaById.get(id);
      if (!media) continue;
      const printWidth = media.src.print?.width ?? media.width ?? 0;
      if (printWidth && printWidth < 1400) {
        issues.push({ code: "LOW_RES_IMAGE", severity: "warning", message: `“${media.fileName ?? id}” is ${printWidth}px wide (print wants ≥ 1400px).` });
      }
    }

    reports.push({
      pageNumber: measure.number,
      pageId: measure.pageId,
      template,
      family,
      isContinuation,
      usableAreaOccupancy: occupancy,
      emptySpaceRatio: Math.round((1 - occupancy) * 1000) / 1000,
      tailGapRatio: tailGap,
      minFlowFill,
      overflowCount,
      orphanCount,
      widowCount,
      imageCount: measure.imageCount,
      imagesFailed: measure.imagesFailed,
      repeatedImages,
      blank: measure.blank,
      issues,
      hardFail: issues.some((i) => i.severity === "error"),
    });
  }

  const issueCounts: Record<string, number> = {};
  for (const r of reports) for (const i of r.issues) issueCounts[i.code] = (issueCounts[i.code] ?? 0) + 1;
  const hardFailures = reports.filter((r) => r.hardFail).length;
  const softWarnings = reports.reduce((n, r) => n + r.issues.filter((i) => i.severity === "warning").length, 0);
  const editorial = reports.filter((r) => !SPARSE_BY_DESIGN.has(r.template));
  const averageOccupancy = editorial.length ? editorial.reduce((n, r) => n + r.usableAreaOccupancy, 0) / editorial.length : 0;

  return {
    ok: hardFailures === 0,
    pages: reports,
    totalPages: reports.length,
    hardFailures,
    softWarnings,
    averageOccupancy: Math.round(averageOccupancy * 1000) / 1000,
    failingPages: reports.filter((r) => r.hardFail).map((r) => r.pageNumber),
    weakPages: reports.filter((r) => !r.hardFail && r.issues.length).map((r) => r.pageNumber),
    overflowPages: reports.filter((r) => r.overflowCount > 0).map((r) => r.pageNumber),
    issueCounts,
  };
}

/** One-line-per-page table for the CLI audit and the render log. */
export function formatQualityTable(report: IssueQualityReport): string {
  const head = "page  template            occ%  tail%  flow%  issues";
  const rows = report.pages.map((p) => {
    const occ = String(Math.round(p.usableAreaOccupancy * 100)).padStart(4);
    const tail = String(Math.round(p.tailGapRatio * 100)).padStart(5);
    const flow = p.minFlowFill === null ? "    -" : String(Math.round(p.minFlowFill * 100)).padStart(5);
    const marks = p.issues.map((i) => (i.severity === "error" ? i.code : i.code.toLowerCase())).join(" ");
    return `${String(p.pageNumber).padStart(4)}  ${p.template.padEnd(18)}${occ}  ${tail}  ${flow}  ${marks}`;
  });
  const summary = `${report.totalPages} pages · avg occupancy ${Math.round(report.averageOccupancy * 100)} % · ${report.hardFailures} hard failure(s) · ${report.softWarnings} warning(s)`;
  return [head, ...rows, "", summary].join("\n");
}
