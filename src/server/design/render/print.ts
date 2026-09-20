import { html, join, raw, type Html } from "@/server/publication/templates/html";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM, type BrandSystem } from "@/lib/brand/system";
import { buildScale, MEDIUM_BASE, type TypeScale } from "@/lib/design/type-scale";
import type { DesignGrid } from "@/lib/design/model";
import type { ResolvedDirection } from "@/lib/design/identity";
import type { PersonalityKey } from "@/lib/brand/typography";
import { DENSITY } from "@/lib/publication/layout-rules";
import {
  absorb,
  demote,
  dropEmpty,
  findPage,
  jumpSource,
  jumpTarget,
  reflow,
  splitCopy,
  tighten,
  type PageSurface,
  type PrintPage,
  type PrintPlan,
} from "@/lib/design/pages";
import { designCss } from "./css";
import { renderBlock } from "./html";
import type { ResolveContext } from "./content";

/**
 * The design, printed.
 *
 * Print is the medium that cannot be fudged: a page is a fixed rectangle, text that does not fit
 * does not scroll, and a photograph placed badly stays badly placed for the life of the issue.
 * Everything the model states as intent — importance, atomicity, what may not be broken — is
 * finally enforced here, which is why this is the renderer that proves the design is real rather
 * than the one that is hardest to write.
 *
 * Two passes, as in any typesetting system worth the name. The first renders the plan and asks a
 * browser what actually fits; the second acts on the answer — carrying copy over, absorbing a
 * continuation that did not earn its paper, tightening a page that is nearly there — and asks
 * again. The arithmetic is never guessed from character counts, and the moves are pure functions
 * over the plan, so the same design with the same fonts gives the same pages every time.
 */

export type PrintWords = { continuedOn: (page: number) => string; continuedFrom: (page: number) => string };

const WORDS: Record<string, PrintWords> = {
  en: { continuedOn: (page) => `Continued on page ${page}`, continuedFrom: (page) => `Continued from page ${page}` },
  fr: { continuedOn: (page) => `Suite page ${page}`, continuedFrom: (page) => `Suite de la page ${page}` },
};

export function printWords(locale: string | undefined): PrintWords {
  return WORDS[(locale ?? "en").slice(0, 2).toLowerCase()] ?? WORDS.en;
}

export type PrintRenderOptions = {
  plan: PrintPlan;
  grid: DesignGrid;
  direction: ResolvedDirection;
  content: ResolveContext;
  brand?: BrandSystem;
  personality?: PersonalityKey;
  locale?: string;
  /** The masthead's own words, printed in the running head. */
  title: string;
  issueLabel?: string | null;
  fontCss?: string;
  /** Extra rules for a preview desk: the PDF pass never passes any. */
  extraCss?: string;
};

/* ── Geometry ────────────────────────────────────────────────────────────────────────────── */

/**
 * Margins, from the grid's own units rather than from a designer's habit.
 *
 * The grid states margins in columns-equivalent units, so an airy publication asks for more space
 * and a dense one for less — and the same number means the same proportion on A5 as on Tabloid.
 * The floor and the ceiling are the printer's: under 8 mm the trim eats the text, and past a fifth
 * of the page the measure collapses.
 */
export function marginsMm(grid: DesignGrid, widthMm: number): { top: number; right: number; bottom: number; left: number } {
  const column = widthMm / grid.columns;
  const clamp = (units: number) => Math.round(Math.min(widthMm * 0.2, Math.max(8, units * column)) * 10) / 10;
  return { top: clamp(grid.margins.top), right: clamp(grid.margins.right), bottom: clamp(grid.margins.bottom), left: clamp(grid.margins.left) };
}

/**
 * The stylesheet for paper.
 *
 * The design's own CSS underneath, and on top of it the things only print has: a page box, a sheet
 * inside the margins, a folio, bleed that reaches the trim, and the copyfit steps that let a page
 * which is 4 % too long be set 4 % tighter instead of spilling a paragraph onto a page of its own.
 */
export function printCss(options: PrintRenderOptions): string {
  const brand = options.brand ?? DEFAULT_BRAND_SYSTEM;
  const tokens = compileBrandSystem(brand);
  const personality = options.personality ?? brand.personality;
  const scale = buildScale(options.direction, personality, "print");
  const { size } = options.plan;
  const margins = marginsMm(options.grid, size.widthMm);
  const design = designCss({ tokens, scale, grid: options.grid, direction: options.direction, medium: "print" });

  const bodySize = scale.roles.body.size;
  const bodyLeading = scale.roles.body.leading;
  const floor = MEDIUM_BASE.print.minBody;
  // 2.5 % of type per step, and half that of leading: tightening the leading first is what an
  // art director does, and it is what a reader notices last.
  const fitRules = [1, 2, 3, 4]
    .map((step) => {
      const size = Math.max(floor, Math.round(bodySize * (1 - step * 0.025) * 100) / 100);
      const leading = Math.round(bodyLeading * (1 - step * 0.0125) * 1000) / 1000;
      // Space closes before type shrinks: a reader notices a smaller letter long before a smaller
      // gap, so a page set one step tighter loses 6 % of its air and 2.5 % of its type.
      const space = Math.round(tokens.shape.unit * (1 - step * 0.06) * 100) / 100;
      return (
        `.page[data-fit="${step}"]{--space:${space}px;}\n` +
        `.page[data-fit="${step}"] .body,.page[data-fit="${step}"] .body p{font-size:${size}pt;line-height:${leading};}`
      );
    })
    .join("\n");

  return `${design}

/* ── Paper ─────────────────────────────────────────────────────────────────────────────── */
@page{size:${size.widthMm}mm ${size.heightMm}mm;margin:0;}
html,body{margin:0;padding:0;background:var(--paper);}
body{-webkit-print-color-adjust:exact;print-color-adjust:exact;font-kerning:normal;font-variant-ligatures:common-ligatures;text-rendering:geometricPrecision;}
.page{
  --page-w:${size.widthMm}mm;--page-h:${size.heightMm}mm;
  --margin-top:${margins.top}mm;--margin-right:${margins.right}mm;--margin-bottom:${margins.bottom}mm;--margin-left:${margins.left}mm;
  --sheet-h:calc(${size.heightMm}mm - ${margins.top}mm - ${margins.bottom}mm);
  position:relative;width:var(--page-w);height:var(--page-h);overflow:hidden;background:var(--paper);
  break-after:page;page-break-after:always;break-inside:avoid;
}
.page:last-child{break-after:auto;page-break-after:auto;}
.sheet{position:absolute;top:var(--margin-top);right:var(--margin-right);bottom:var(--margin-bottom);left:var(--margin-left);display:flex;flex-direction:column;min-height:0;}
.page[data-bleed-sheet="true"] .sheet{top:0;right:0;bottom:0;left:0;}
.page-body{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;}
.page-body > .surface{padding:0;}
.page-body > .surface + .surface{margin-top:calc(var(--space) * 3);}
.running{flex:none;display:flex;justify-content:space-between;align-items:baseline;padding-bottom:calc(var(--space) * 1);margin-bottom:calc(var(--space) * 2);border-bottom:var(--border) solid var(--rule);color:var(--subdued);}
.folio{flex:none;display:flex;justify-content:space-between;align-items:baseline;padding-top:calc(var(--space) * 1);margin-top:calc(var(--space) * 2);color:var(--subdued);}
.page[data-side="left"] .folio{flex-direction:row-reverse;}
.folio .number{font-variant-numeric:tabular-nums;}
.jump{text-transform:uppercase;letter-spacing:0.08em;}
.continued-from{color:var(--subdued);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:calc(var(--space) * 1);}

/* Text set on paper: no orphan, no widow, and a hyphenation dictionary that knows the language. */
.body{orphans:2;widows:2;hyphens:auto;}
.headline,.deck,.quote{hyphens:manual;}
.block[data-keep="true"]{break-inside:avoid;}

/*
 * A photograph gets a frame, not a page.
 *
 * On a screen a tall picture is a scroll; on paper it is a page nobody planned. So the frame's
 * height is decided by what the picture is for — a lead's opening image may take half the sheet, a
 * brief's thumbnail a fifth — and the crop covers whatever frame it is given. Without this the
 * photograph's own proportions decide the pagination, which is how a publication ends up with one
 * picture per page and no design.
 */
.page-body figure img{height:auto;max-height:calc(var(--sheet-h) * 0.42);object-fit:cover;}
.page-body [data-importance="LEAD"] figure img{max-height:calc(var(--sheet-h) * 0.5);}
.page-body [data-importance="MAJOR"] figure img{max-height:calc(var(--sheet-h) * 0.38);}
.page-body [data-importance="STANDARD"] figure img{max-height:calc(var(--sheet-h) * 0.3);}
.page-body [data-importance="BRIEF"] figure img,.page-body [data-importance="SUPPORTING"] figure img{max-height:calc(var(--sheet-h) * 0.24);}
/* Pictures set in rows share the sheet between them rather than each claiming their own share. */
.page-body .b-photo-pair figure img,.page-body .c-three-up figure img,.page-body .c-strip figure img{max-height:calc(var(--sheet-h) * 0.34);}
.page-body .c-two-by-two figure img,.page-body .c-mosaic figure img{max-height:calc(var(--sheet-h) * 0.33);}
.page-body .c-lead-and-three figure img{max-height:calc(var(--sheet-h) * 0.3);}
.page-body .c-lead-and-three figure:first-child img{max-height:calc(var(--sheet-h) * 0.44);}
.page-body .c-full-spread figure img,.page-body .block[data-bleed="true"] figure img{max-height:calc(var(--sheet-h) * 0.72);}
/* A photo spread is a page given to pictures. Setting it at the size of an illustration beside an
   article is how a visual reset turns into a band of stamps with an empty page under it. */
.page-body .b-photo-spread figure img{max-height:calc(var(--sheet-h) * 0.5);}
.page-body .b-photo-spread.c-lead-and-three figure img{max-height:calc(var(--sheet-h) * 0.26);}
.page-body .b-photo-spread.c-lead-and-three figure:first-child img{max-height:calc(var(--sheet-h) * 0.52);}
.page-body .b-photo-spread.c-full-spread figure img{max-height:calc(var(--sheet-h) * 0.8);}

/*
 * A cover is the whole page.
 *
 * The picture is anchored to the page rather than to the block, or it covers only the row the
 * block happens to occupy — which is how a cover ends up as a masthead, a band of white, and a
 * photograph starting half way down. The furniture then sits on the picture, in the order the
 * design put it, with the last block at the foot where a cover line belongs.
 */
.page[data-kind="cover"] .page-body{position:relative;}
/* Flex rather than grid: the masthead keeps its own height at the top and the cover takes the rest,
   whether or not there is a masthead at all. A cover is the one page whose furniture has a place. */
.page[data-kind="cover"] .page-body > .surface{display:flex;flex-direction:column;height:100%;position:relative;z-index:1;}
.page[data-kind="cover"] .b-masthead{flex:none;}
.page[data-kind="cover"] .b-cover{flex:1 1 auto;min-height:0;position:static;justify-content:flex-end;}
.page[data-kind="cover"] .b-cover figure{position:absolute;inset:0;z-index:-1;}
.page[data-kind="cover"] figure img{max-height:none;height:100%;object-fit:cover;}
.page[data-kind="cover"] .b-masthead{position:relative;z-index:1;}
/*
 * A veil at the head as well as the foot.
 *
 * The masthead sits at the top of the picture, and a photograph is light up there as often as it is
 * dark — so the cover carries the title in white over whatever the photographer happened to shoot.
 * Two gradients: strong where the cover lines are, just enough where the masthead is, nothing in
 * between, so the photograph is still the photograph.
 */
.page[data-kind="cover"] .b-cover figure::after{background:linear-gradient(to top, rgba(0,0,0,${Math.min(0.85, 0.45 + tokens.imagery.scrim * 0.4).toFixed(2)}) 0%, rgba(0,0,0,${Math.min(0.5, tokens.imagery.scrim * 0.3).toFixed(2)}) 45%, rgba(0,0,0,0) 78%),linear-gradient(to bottom, rgba(0,0,0,${Math.min(0.7, 0.34 + tokens.imagery.scrim * 0.3).toFixed(2)}) 0%, rgba(0,0,0,0) 20%);}
/* A masthead over a photograph is type over a photograph, and obeys the same rule as the rest. */
.page[data-cover="image-led"] .b-masthead p{color:${tokens.surfaces.ink.foreground};text-shadow:0 1px 2px rgba(0,0,0,0.35);}

/* Bleed reaches the trim, which on paper is the edge of the sheet and not the edge of the text. */
.page-body .block[data-bleed="true"]{margin-left:calc(-1 * var(--margin-left));margin-right:calc(-1 * var(--margin-right));width:var(--page-w);}
.page[data-bleed-sheet="true"] .block[data-bleed="true"]{margin:0;width:100%;}
.b-cover{min-height:100%;}

${fitRules}
${options.extraCss ?? ""}`;
}

/* ── The pages ───────────────────────────────────────────────────────────────────────────── */

function surfaceMarkup(surface: PageSurface, page: PrintPage, options: PrintRenderOptions, ctx: ResolveContext, typography: { scale: TypeScale; contentWidth: number }): Html | null {
  const blocks = surface.blocks.map((block) => renderBlock(block, { medium: "print", content: ctx, baseLevel: 1, typography })).filter((markup) => markup.value.length > 0);
  if (!blocks.length) return null;
  const words = printWords(options.locale);
  const from = surface.continued ? jumpSource(options.plan, page.id, surface.surfaceId) : null;
  const onward = surface.continues ? jumpTarget(options.plan, page.id, surface.surfaceId) : null;
  return html`<section class="surface" data-kind="${surface.kind}" data-surface="${surface.surfaceId}" aria-label="${surface.sectionName}">${
    from ? html`<p class="continued-from t-metadata">${words.continuedFrom(from)}</p>` : ""
  }${join(blocks, "\n")}${onward ? html`<p class="jump t-metadata">${words.continuedOn(onward)}</p>` : ""}</section>`;
}

/** One millimetre in points, which is the unit a printed type scale is stated in. */
const MM_TO_PT = 2.83465;

export function renderPrintPage(page: PrintPage, options: PrintRenderOptions): Html {
  const total = options.plan.pages.length;
  const brandFor = options.brand ?? DEFAULT_BRAND_SYSTEM;
  const scale = buildScale(options.direction, options.personality ?? brandFor.personality, "print");
  const margins = marginsMm(options.grid, options.plan.size.widthMm);
  const contentWidth = (options.plan.size.widthMm - margins.left - margins.right) * MM_TO_PT;
  const ctx: ResolveContext = { ...options.content, medium: "print", locale: options.locale ?? options.content.locale, page: { number: page.number, total } };
  const first = page.surfaces[0];
  const coverBlock = first?.kind === "cover" ? first.blocks.find((block) => block.role === "cover") : undefined;
  // A cover and a full-bleed opener own the whole sheet; furniture on them is a design decision
  // the composition makes, not something the page chrome imposes.
  const bleedSheet = Boolean(first && (first.kind === "cover" || (first.kind === "opener" && first.blocks.some((block) => block.constraints.fullBleed))));
  const furniture = !page.blank && !bleedSheet && first?.kind !== "cover";
  const surfaces = page.surfaces.map((surface) => surfaceMarkup(surface, page, options, ctx, { scale, contentWidth })).filter((markup): markup is Html => Boolean(markup));
  const section = page.surfaces.find((surface) => surface.sectionName)?.sectionName ?? "";

  return html`<div class="page" id="${page.id}" data-page="${page.id}" data-number="${page.number}" data-side="${page.side}" data-kind="${first?.kind ?? "blank"}" data-fit="${page.fit}"${raw(coverBlock ? ` data-cover="${coverBlock.composition}"` : "")}${raw(
    bleedSheet ? ' data-bleed-sheet="true"' : "",
  )}${raw(page.blank ? ' data-blank="true"' : "")}>
  <div class="sheet">
    ${furniture ? html`<header class="running t-metadata"><span>${options.title}</span><span>${section}</span></header>` : ""}
    <div class="page-body">${join(surfaces, "\n")}</div>
    ${furniture ? html`<footer class="folio t-metadata"><span class="issue">${options.issueLabel ?? ""}</span><span class="number">${page.number}</span></footer>` : ""}
  </div>
</div>`;
}

export function renderPrintEdition(options: PrintRenderOptions): string {
  const css = printCss(options);
  const pages = options.plan.pages.map((page) => renderPrintPage(page, options));
  const locale = options.locale ?? "en";
  return html`<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${options.title}${options.issueLabel ? ` — ${options.issueLabel}` : ""}</title>
<meta name="generator" content="Briefly editorial design engine">
${options.fontCss ? html`<style>${raw(options.fontCss)}</style>` : ""}
<style>${raw(css)}</style>
</head>
<body class="s-paper">
${join(pages, "\n")}
</body>
</html>`.value;
}

/* ── What the browser is asked ───────────────────────────────────────────────────────────── */

export type CopyMeasurement = { blockId: string; keep: string[]; tail: string[] };

export type PrintMeasurement = {
  pageId: string;
  number: number;
  blank: boolean;
  /** Design blocks entirely inside the sheet. */
  fitting: string[];
  overflowing: string[];
  /** Blocks that begin on the page and end past it — the ones worth splitting rather than moving. */
  copy: CopyMeasurement[];
  /** Unused height under the last thing on the page, as a share of the sheet. */
  tailGap: number;
  /** Content height over the sheet's height: 1.06 means 6 % too much. */
  extent: number;
};

/**
 * Measurement, run inside the page.
 *
 * Deliberately dumb: it reports rectangles and nothing else. Every judgement — whether a gap is a
 * defect, whether a block may be broken — is made outside, where it can be tested without a
 * browser.
 */
export const PRINT_MEASURE_SCRIPT = `(() => {
  const tol = 0.75;
  const idsOf = (nodes, attribute) => nodes.map((node) => node.getAttribute(attribute)).filter(Boolean);
  const boxOf = (el) => {
    const rects = Array.from(el.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) return null;
    return { top: Math.min.apply(null, rects.map((r) => r.top)), bottom: Math.max.apply(null, rects.map((r) => r.bottom)) };
  };
  return Array.from(document.querySelectorAll('.page')).map((page) => {
    const area = page.querySelector('.page-body');
    const fr = area.getBoundingClientRect();
    const height = fr.height || 1;
    const fitting = [];
    const overflowing = [];
    const partial = [];
    let lowest = fr.top;
    for (const el of Array.from(area.querySelectorAll('[data-block][data-role]'))) {
      const id = el.getAttribute('data-block');
      const box = boxOf(el);
      if (!box) { fitting.push(id); continue; }
      if (box.bottom > lowest) lowest = box.bottom;
      if (box.bottom <= fr.bottom + tol) { fitting.push(id); continue; }
      overflowing.push(id);
      if (box.top < fr.bottom - tol) partial.push(el);
    }
    const copy = partial.map((el) => {
      const items = Array.from(el.querySelectorAll('.body > [data-copy]'));
      const keep = [];
      const tail = [];
      for (const item of items) {
        const box = boxOf(item);
        if (box && box.bottom <= fr.bottom + tol) keep.push(item.getAttribute('data-copy'));
        else tail.push(item.getAttribute('data-copy'));
      }
      return { blockId: el.getAttribute('data-block'), keep: keep, tail: tail };
    }).filter((entry) => entry.keep.length && entry.tail.length);
    return {
      pageId: page.getAttribute('data-page'),
      number: Number(page.getAttribute('data-number') || 0),
      blank: page.getAttribute('data-blank') === 'true',
      fitting: fitting,
      overflowing: overflowing,
      copy: copy,
      tailGap: Math.max(0, (fr.bottom - Math.min(lowest, fr.bottom)) / height),
      extent: (lowest - fr.top) / height,
    };
  });
})()`;

/* ── The loop ────────────────────────────────────────────────────────────────────────────── */

export type PrintReport = {
  rounds: number;
  pagesAdded: number;
  copySplits: number;
  tightened: number;
  absorbed: number;
  /** Blocks moved off a page the design wanted whole. Every one is recorded on the plan. */
  demoted: number;
  /** Pages still overflowing when the budget ran out. Zero is the only acceptable number. */
  overflowing: number[];
  /** Pages that did not earn their paper. Covers and openers are not counted: space is the point. */
  underfilled: number[];
  settled: boolean;
};

/** What a measurement says about a settled plan: the same reading for the loop and for the PDF. */
export function reportFrom(plan: PrintPlan, measures: PrintMeasurement[], stats: { rounds: number; pagesAdded: number; copySplits: number; tightened: number; absorbed: number; demoted: number; settled: boolean }): PrintReport {
  const overflowing = measures.filter((measure) => measure.overflowing.length).map((measure) => measure.number);
  const underfilled = measures
    .filter((measure) => {
      const page = findPage(plan, measure.pageId);
      if (!page || page.blank) return false;
      if (page.surfaces.some((surface) => SPARSE_BY_DESIGN.has(surface.kind))) return false;
      return measure.tailGap > DENSITY.hardTailGap;
    })
    .map((measure) => measure.number);
  return { ...stats, overflowing, underfilled, settled: stats.settled && !overflowing.length };
}

export type PaginateDesignOptions = {
  plan: PrintPlan;
  render: (plan: PrintPlan) => string;
  measure: (markup: string) => Promise<PrintMeasurement[]>;
  maxRounds?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
};

/** Surfaces whose emptiness is the design, and which are never "underfilled". */
const SPARSE_BY_DESIGN = new Set(["cover", "opener", "close"]);

export async function paginateDesign(options: PaginateDesignOptions): Promise<{ plan: PrintPlan; report: PrintReport; markup: string; measures: PrintMeasurement[] }> {
  const maxRounds = options.maxRounds ?? 10;
  const say = options.log ?? (() => {});
  let plan = options.plan;
  let markup = options.render(plan);
  let measures: PrintMeasurement[] = [];
  const stats = { pagesAdded: 0, copySplits: 0, tightened: 0, absorbed: 0, demoted: 0 };
  const absorbTried = new Set<string>();
  let rounds = 0;
  let settled = false;

  const look = async () => {
    markup = options.render(plan);
    measures = await options.measure(markup);
    return measures;
  };

  /**
   * Everything that does not fit, in the order a typesetter would try it: break the copy, carry
   * what is left, set the page tighter, and only then overrule the design.
   */
  const fixOverflow = (): boolean => {
    let changed = false;
    for (const measure of measures.filter((candidate) => candidate.overflowing.length)) {
      const page = findPage(plan, measure.pageId);
      if (!page) continue;
      const fitting = new Set(measure.fitting);
      for (const copy of measure.copy) {
        const split = splitCopy(plan, page.id, copy.blockId, copy.keep, copy.tail);
        if (!split) continue;
        plan = split.plan;
        fitting.add(copy.blockId);
        stats.copySplits += 1;
        changed = true;
      }
      const carried = reflow(plan, page.id, fitting);
      if (carried) {
        plan = carried.plan;
        stats.pagesAdded += 1;
        changed = true;
        say("carried blocks onto a new page", { page: measure.number, moved: carried.moved.length });
        continue;
      }
      const tightened = tighten(plan, page.id);
      if (tightened) {
        plan = tightened;
        stats.tightened += 1;
        changed = true;
        say("set a page tighter", { page: measure.number, over: Math.round((measure.extent - 1) * 100) });
        continue;
      }
      // Tighter than this is unreadable. Something has to leave the page, and the design said
      // which: the lowest priority goes, and the plan records that it was overruled.
      const demoted = demote(plan, page.id, measure.overflowing);
      if (demoted) {
        plan = demoted.plan;
        stats.demoted += 1;
        changed = true;
        say("moved the least important block off a page that would not fit", { page: measure.number });
      }
    }
    return changed;
  };

  /**
   * Paper spent on nothing, which is the defect that makes a publication look machine-made.
   *
   * Only attempted when nothing is overflowing, and only where the two pages have been measured
   * to fit together — guessing and then discovering is what produced a page of four paragraphs
   * followed by a page that spilled.
   */
  const fillGaps = (): boolean => {
    let changed = false;
    let absorbed = 0;
    for (const [position, measure] of measures.entries()) {
      if (absorbed >= 4) break;
      const index = plan.pages.findIndex((candidate) => candidate.id === measure.pageId);
      const page = index >= 0 ? plan.pages[index] : null;
      const next = index >= 0 ? plan.pages[index + 1] : null;
      const after = measures[position + 1];
      if (!page || !next || page.blank || next.blank || !after || after.pageId !== next.id) continue;
      if (page.surfaces.some((surface) => SPARSE_BY_DESIGN.has(surface.kind))) continue;
      if (measure.tailGap <= DENSITY.hardTailGap) continue;
      // The two pages have both been measured: they either fit together or they do not.
      if (measure.extent + after.extent > 0.96) continue;
      // Keyed by surfaces rather than pages: a page carried over gets a new id every round, and a
      // pair keyed by id would let the engine absorb and re-split the same two surfaces for ever.
      const pair = `${page.surfaces.map((surface) => surface.surfaceId).join(",")}>${next.surfaces.map((surface) => surface.surfaceId).join(",")}`;
      if (absorbTried.has(pair)) continue;
      absorbTried.add(pair);
      const merged = absorb(plan, page.id);
      if (!merged) continue;
      plan = merged;
      stats.absorbed += 1;
      absorbed += 1;
      changed = true;
      say("pulled the next page up", { page: measure.number, gap: Math.round(measure.tailGap * 100) });
    }
    return changed;
  };

  for (let round = 1; round <= maxRounds; round += 1) {
    rounds = round;
    await look();
    const changed = fixOverflow() || fillGaps();
    if (!changed) {
      settled = true;
      break;
    }
  }

  // Whatever else happened, the issue does not go out with a page spilling off the sheet. The last
  // rounds repair only — no absorbing, nothing that could introduce what it is here to remove.
  for (let repair = 0; repair < 3; repair += 1) {
    await look();
    if (!measures.some((measure) => measure.overflowing.length)) break;
    rounds += 1;
    if (!fixOverflow()) break;
  }

  plan = dropEmpty(plan);
  markup = options.render(plan);
  measures = await options.measure(markup);

  return { plan, report: reportFrom(plan, measures, { rounds, ...stats, settled }), markup, measures };
}
