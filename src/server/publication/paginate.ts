import type { ArticleBlock, DocumentPage, EditionDocument, PageSlice } from "@/lib/publication/document";
import { splitParagraphAtSentence } from "@/lib/publication/text";
import { DENSITY, FIT_LEVEL_RANGE, IMAGE_LEVEL_RANGE, LOOSE_ALLOWED, MULTI_STORY_TEMPLATES, SPARSE_BY_DESIGN, TEMPLATE_ALTERNATIVES } from "@/lib/publication/layout-rules";

/**
 * Deterministic pagination.
 *
 * The print HTML places each planned page's content into fixed containers; flowing text lives in
 * `.flow` elements (CSS multi-column, `column-fill: auto`, fixed height). In the browser we measure,
 * for every flow, which blocks overflow the box (blocks in overflow columns have client rects to
 * the right of / below the flow). Overflowing blocks are moved — whole blocks, or the tail of a
 * paragraph split at a sentence boundary — onto a CONTINUATION page inserted right after, and the
 * document is re-rendered and re-measured until nothing overflows. Pages are then renumbered and
 * the contents / cover teasers rebuilt. Same input + same fonts + same engine → same output.
 */

export type MeasuredBlock = {
  id: string;
  type: string;
  fits: boolean;
  /** Starts inside the visible area but ends beyond it (candidate for a sentence split). */
  partial: boolean;
  sentencesFit: number;
  sentenceCount: number;
};

export type FlowMeasurement = {
  flow: string;
  pageId: string;
  articleId: string;
  cols: number;
  blocks: MeasuredBlock[];
  overflow: boolean;
  fillRatio: number;
  /** Content extent (including overflow columns) relative to the available area: 1.08 = 8 % too much text. */
  extentRatio: number;
  fitLevel: number;
  /** Unused area of the flow box, as a fraction: 0.3 = the flow's last column stops 30 % short. */
  slackRatio: number;
  /** A block's first line left alone at the foot of a column. */
  orphans: number;
  /** A block's last line left alone at the head of a column. */
  widows: number;
};

/**
 * Density of one page, measured against `.sheet` — the usable editorial area inside the margins.
 * `occupancy` is a true union (grid raster) of text, images and coloured panels, so a full-bleed
 * photo reads ≈ 1 and a headline-plus-one-paragraph page reads low. `tailGapRatio` is the single
 * most useful defect signal: unused height between the last content and the foot of the sheet.
 */
export type PageDensity = {
  occupancy: number;
  tailGapRatio: number;
  sheetHeight: number;
  contentBottom: number;
};

export type PageMeasurement = {
  pageId: string;
  number: number;
  template: string;
  flows: FlowMeasurement[];
  blank: boolean;
  textLength: number;
  imageCount: number;
  imagesFailed: string[];
  density: PageDensity;
};

/** Browser-side measurement (evaluated with page.evaluate). Returns PageMeasurement[]. */
export const MEASURE_SCRIPT = `(() => {
  const tol = 0.75;
  const inside = (r, fr) => r.right <= fr.right + tol && r.bottom <= fr.bottom + tol;
  const GX = 48, GY = 64;
  const isPaper = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
  /** Elements that actually put ink on the page: text leaves, images, coloured panels and rules. */
  const inkRects = (root) => {
    const out = [];
    const all = root.querySelectorAll('*');
    for (const el of all) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      let ink = false;
      if (el.tagName === 'IMG' || el.tagName === 'SVG' || cs.backgroundImage !== 'none') ink = true;
      else if (!isPaper(cs.backgroundColor)) ink = true;
      else {
        for (const n of el.childNodes) {
          if (n.nodeType === 3 && n.textContent && n.textContent.trim().length) { ink = true; break; }
        }
      }
      if (!ink) continue;
      for (const r of el.getClientRects()) if (r.width > 0.5 && r.height > 0.5) out.push(r);
    }
    return out;
  };
  const pages = Array.from(document.querySelectorAll('.page'));
  return pages.map((page) => {
    const flows = Array.from(page.querySelectorAll('.flow[data-flow]')).map((flow) => {
      const fr = flow.getBoundingClientRect();
      const cols = Number(flow.getAttribute('data-cols') || 1);
      let maxBottom = 0;
      let maxRight = 0;
      let maxExtent = 0;
      let orphans = 0;
      let widows = 0;
      const colWidth = fr.width / cols;
      const blocks = Array.from(flow.querySelectorAll(':scope > [data-block]')).map((b) => {
        const rects = Array.from(b.getClientRects());
        const fits = rects.length === 0 || rects.every((r) => inside(r, fr));
        const startsInside = rects.length === 0 || (rects[0].left < fr.right - tol && rects[0].top < fr.bottom - tol);
        const type = b.getAttribute('data-type') || '';
        let sentencesFit = 0;
        let sentenceCount = 0;
        if (!fits && startsInside && (type === 'paragraph' || type === 'qa' || type === 'testimony')) {
          const spans = Array.from(b.querySelectorAll('span.s'));
          sentenceCount = spans.length;
          for (const s of spans) {
            const srects = Array.from(s.getClientRects());
            if (srects.length && srects.every((r) => inside(r, fr))) sentencesFit += 1;
            else break;
          }
        }
        // A block broken across columns leaves an orphan (first line alone at a column foot) or a
        // widow (last line alone at a column head) when its edge fragment is barely one line tall.
        if (rects.length > 1 && (type === 'paragraph' || type === 'qa' || type === 'testimony')) {
          const lh = parseFloat(getComputedStyle(b).lineHeight) || 0;
          if (lh > 0) {
            if (rects[0].height < lh * 1.6) orphans += 1;
            if (rects[rects.length - 1].height < lh * 1.6) widows += 1;
          }
        }
        for (const r of rects) {
          if (inside(r, fr)) {
            maxBottom = Math.max(maxBottom, r.bottom - fr.top);
            maxRight = Math.max(maxRight, r.right - fr.left);
          }
          const colIndex = Math.max(0, Math.floor((r.left - fr.left + 1) / colWidth));
          maxExtent = Math.max(maxExtent, colIndex * fr.height + (r.bottom - fr.top));
        }
        return { id: b.getAttribute('data-block'), type, fits, partial: !fits && startsInside, sentencesFit, sentenceCount };
      });
      const lastCol = Math.min(cols, Math.max(1, Math.ceil(maxRight / colWidth - 0.01)));
      const fill = fr.height > 0 ? Math.min(1, ((lastCol - 1) * fr.height + maxBottom) / (cols * fr.height)) : 0;
      return {
        flow: flow.getAttribute('data-flow'),
        pageId: flow.getAttribute('data-page'),
        articleId: flow.getAttribute('data-article'),
        cols,
        blocks,
        overflow: blocks.some((b) => !b.fits),
        fillRatio: Math.round(fill * 1000) / 1000,
        extentRatio: fr.height > 0 ? Math.round((maxExtent / (cols * fr.height)) * 1000) / 1000 : 0,
        fitLevel: Number(flow.getAttribute('data-fit') || 0),
        slackRatio: Math.round((1 - fill) * 1000) / 1000,
        orphans,
        widows,
      };
    });
    const imgs = Array.from(page.querySelectorAll('img[data-media]'));
    const failed = imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('data-media'));
    const text = (page.innerText || '').replace(/\\s+/g, ' ').trim();
    // ── density, measured against the usable editorial area (.sheet) ──
    const sheet = page.querySelector('.sheet') || page;
    const sr = sheet.getBoundingClientRect();
    const rects = inkRects(page);
    let contentBottom = sr.top;
    const grid = new Uint8Array(GX * GY);
    const cw = sr.width / GX;
    const ch = sr.height / GY;
    for (const r of rects) {
      const top = Math.max(r.top, sr.top), bottom = Math.min(r.bottom, sr.bottom);
      const left = Math.max(r.left, sr.left), right = Math.min(r.right, sr.right);
      if (bottom <= top || right <= left) continue;
      contentBottom = Math.max(contentBottom, bottom);
      if (cw <= 0 || ch <= 0) continue;
      const x0 = Math.max(0, Math.floor((left - sr.left) / cw));
      const x1 = Math.min(GX - 1, Math.ceil((right - sr.left) / cw) - 1);
      const y0 = Math.max(0, Math.floor((top - sr.top) / ch));
      const y1 = Math.min(GY - 1, Math.ceil((bottom - sr.top) / ch) - 1);
      for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) grid[y * GX + x] = 1;
    }
    let filled = 0;
    for (let i = 0; i < grid.length; i += 1) filled += grid[i];
    const tailGap = sr.height > 0 ? Math.max(0, (sr.bottom - contentBottom) / sr.height) : 0;
    return {
      pageId: page.getAttribute('data-page'),
      number: Number(page.getAttribute('data-number')),
      template: page.getAttribute('data-template'),
      flows,
      blank: text.length < 40 && imgs.length === 0,
      textLength: text.length,
      imageCount: imgs.length,
      imagesFailed: failed,
      density: {
        occupancy: Math.round((filled / (GX * GY)) * 1000) / 1000,
        tailGapRatio: Math.round(tailGap * 1000) / 1000,
        sheetHeight: Math.round(sr.height * 10) / 10,
        contentBottom: Math.round((contentBottom - sr.top) * 10) / 10,
      },
    };
  });
})()`;

export type LayoutReport = {
  ok: boolean;
  pages: number;
  plannedPages: number;
  continuationPagesAdded: number;
  blocksMoved: number;
  paragraphsSplit: number;
  /** Flows whose type was shrunk (copyfit) instead of spilling. */
  copyfitFlows: number;
  rounds: number;
  remainingOverflow: { page: number; pageId: string; articleId: string; blocks: string[] }[];
  blankPages: number[];
  imagesFailed: { page: number; mediaId: string }[];
  fit: { page: number; pageId: string; template: string; articleId: string; ratio: number }[];
  pageCountMismatch?: { expected: number; actual: number };
  engine: string;
  /** Density passes that re-flowed the issue after moving a page's image/type levers. */
  densityPasses?: number;
  densityChanges?: DensityChange[];
  /** Article pages re-set in a denser layout variant to avoid a jump page. */
  templateSwaps?: TemplateSwap[];
  /** Per-page occupancy of the usable editorial area, after the final pass. */
  density?: { page: number; template: string; occupancy: number; tailGap: number }[];
  /**
   * Pages that came out too empty to send.
   *
   * The occupancy of every page was already measured and the floor was already written down; they
   * were simply never introduced to each other, so an issue with a quarter-full page passed as
   * clean. A reader does not care that the text did not overflow.
   */
  underfilled: { page: number; template: string; occupancy: number }[];
  /** Media the renderer could not read from storage: the page prints, the picture does not. */
  mediaMissing?: string[];
  /** A fixed extent that was not met, so the promise to the printer can be shown, not just logged. */
  extentMissed?: { mode: "fixed"; target: number; actual: number };
};

export type PaginateOptions = {
  render: (doc: EditionDocument) => string;
  measure: (html: string) => Promise<PageMeasurement[]>;
  maxRounds?: number;
  /** How many times the density pass may adjust page levers and re-flow. 0 disables it. */
  densityPasses?: number;
  log?: (message: string, meta?: Record<string, unknown>) => void;
  engine?: string;
};

export const CONTINUATION_TEMPLATE = "CONTINUATION";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Removes layout-generated continuation pages and slices so a document can be re-flowed from scratch. */
export function resetLayout(doc: EditionDocument): EditionDocument {
  const out = clone(doc);
  out.pages = out.pages.filter((p) => !(p.template === CONTINUATION_TEMPLATE && p.id.startsWith("cont_")));
  for (const page of out.pages) delete page.slices;
  return renumberPages(out);
}

/** Numbers pages 1..n in array order and refreshes `continuationOf` from `continuationOfPageId`. */
export function renumberPages(doc: EditionDocument): EditionDocument {
  const numberById = new Map<string, number>();
  doc.pages.forEach((p, i) => {
    p.number = i + 1;
    numberById.set(p.id, p.number);
  });
  for (const p of doc.pages) {
    p.continuationOf = p.continuationOfPageId ? (numberById.get(p.continuationOfPageId) ?? null) : null;
  }
  return doc;
}

/** Contents (one line per article, first page it appears on) and cover teaser page numbers. */
export function rebuildToc(doc: EditionDocument): EditionDocument {
  const sectionById = new Map(doc.sections.map((s) => [s.id, s]));
  const articleById = new Map(doc.articles.map((a) => [a.id, a]));
  const firstPage = new Map<string, number>();
  const toc: EditionDocument["toc"] = [];
  for (const page of doc.pages) {
    for (const id of page.articleIds) {
      if (firstPage.has(id)) continue;
      const article = articleById.get(id);
      if (!article) continue;
      firstPage.set(id, page.number);
      const section = (page.sectionId && sectionById.get(page.sectionId)) || (article.sectionId && sectionById.get(article.sectionId)) || null;
      toc.push({ page: page.number, sectionName: section?.name ?? "", text: article.headline || article.storyTitle || "", articleId: id });
    }
  }
  doc.toc = toc;
  doc.meta.cover.teasers = doc.meta.cover.teasers.map((t) => ({ ...t, page: firstPage.get(t.articleId) ?? t.page }));
  return doc;
}

function splitBlock(block: ArticleBlock, keepSentences: number, generation: number): { head: ArticleBlock; tail: ArticleBlock } | null {
  const headId = `${block.id}.${generation}a`;
  const tailId = `${block.id}.${generation}b`;
  if (block.type === "paragraph") {
    const { head, tail } = splitParagraphAtSentence(block.text, keepSentences);
    if (!head || !tail) return null;
    return { head: { ...block, id: headId, text: head }, tail: { ...block, id: tailId, text: tail } };
  }
  if (block.type === "testimony") {
    const { head, tail } = splitParagraphAtSentence(block.text, keepSentences);
    if (!head || !tail) return null;
    return { head: { ...block, id: headId, text: head }, tail: { ...block, id: tailId, text: tail } };
  }
  if (block.type === "qa") {
    const { head, tail } = splitParagraphAtSentence(block.answer, keepSentences);
    if (!head || !tail) return null;
    return { head: { ...block, id: headId, answer: head }, tail: { id: tailId, type: "paragraph", text: tail, sources: block.sources } };
  }
  return null;
}

function findBlock(doc: EditionDocument, page: DocumentPage, articleId: string, blockId: string): ArticleBlock | undefined {
  const slice = page.slices?.find((s) => s.articleId === articleId);
  const fragment = slice?.fragments?.find((f) => f.id === blockId);
  if (fragment) return fragment;
  return doc.articles.find((a) => a.id === articleId)?.body.find((b) => b.id === blockId);
}

function continuationIdFor(sourcePageId: string, doc: EditionDocument): string {
  const base = sourcePageId.startsWith("cont_") ? sourcePageId : `cont_${sourcePageId}`;
  let k = 1;
  while (doc.pages.some((p) => p.id === `${base}_${k}`)) k += 1;
  return `${base}_${k}`;
}

/**
 * Applies one round of measurements: returns true when something changed (blocks moved / pages
 * added). Pages are processed in order; a page's continuation (if it already exists right after it)
 * receives newly overflowing blocks at its start so the reading order is preserved.
 */
export const MAX_FIT_LEVEL = 4;
/** Capacity gained per copyfit level (2.5 % smaller type and leading ≈ 5 % more text). */
const FIT_GAIN = 0.05;

export function applyMeasurements(doc: EditionDocument, measures: PageMeasurement[], stats: { moved: number; split: number; added: number; copyfit: number; generation: number }): boolean {
  let changed = false;
  const measureByPage = new Map(measures.map((m) => [m.pageId, m]));
  // Iterate over a snapshot: we insert pages while walking.
  const order = doc.pages.map((p) => p.id);
  for (const pageId of order) {
    const page = doc.pages.find((p) => p.id === pageId);
    const measure = measureByPage.get(pageId);
    if (!page || !measure) continue;
    for (const flow of measure.flows) {
      if (!flow.overflow) continue;
      const articleId = flow.articleId;
      const firstBad = flow.blocks.findIndex((b) => !b.fits);
      if (firstBad < 0) continue;
      // Copyfit first: a small overflow is absorbed by shrinking the flow's type in ≤ 3 steps.
      const currentSlice = page.slices?.find((s) => s.articleId === articleId);
      const level = currentSlice?.fit ?? 0;
      if (level < MAX_FIT_LEVEL && flow.extentRatio > 0 && flow.extentRatio <= 1 + FIT_GAIN * (MAX_FIT_LEVEL - level)) {
        const ids = flow.blocks.map((b) => b.id);
        page.slices = [
          ...(page.slices ?? []).filter((s) => s.articleId !== articleId),
          { articleId, blockIds: currentSlice?.blockIds ?? ids, fragments: currentSlice?.fragments, fit: level + 1 },
        ];
        stats.copyfit += 1;
        changed = true;
        continue;
      }
      const keepIds: string[] = flow.blocks.slice(0, firstBad).map((b) => b.id);
      const moveIds: string[] = [];
      const fragments: ArticleBlock[] = [...(page.slices?.find((s) => s.articleId === articleId)?.fragments ?? [])];
      const movedFragments: ArticleBlock[] = [];
      const bad = flow.blocks[firstBad];
      let handled = false;
      if (bad.partial && bad.sentencesFit >= 1 && bad.sentenceCount > bad.sentencesFit) {
        const block = findBlock(doc, page, articleId, bad.id);
        if (block) {
          stats.generation += 1;
          const parts = splitBlock(block, bad.sentencesFit, stats.generation);
          if (parts) {
            keepIds.push(parts.head.id);
            fragments.push(parts.head);
            moveIds.push(parts.tail.id);
            movedFragments.push(parts.tail);
            stats.split += 1;
            handled = true;
          }
        }
      }
      if (!handled) {
        const isContinuation = page.template === CONTINUATION_TEMPLATE;
        if (firstBad === 0 && isContinuation) {
          // Nothing fits on a page that is entirely text: keep the block (it will clip) rather than loop forever.
          keepIds.push(bad.id);
          if (flow.blocks.length === 1) continue;
        } else {
          moveIds.push(bad.id);
          const moved = findBlock(doc, page, articleId, bad.id);
          if (moved && !doc.articles.find((a) => a.id === articleId)?.body.some((b) => b.id === bad.id)) movedFragments.push(moved);
        }
      }
      for (const b of flow.blocks.slice(firstBad + 1)) {
        moveIds.push(b.id);
        const frag = fragments.find((f) => f.id === b.id);
        if (frag) movedFragments.push(frag);
      }
      if (!moveIds.length) continue;
      // Update the source page slice.
      const keptFragments = fragments.filter((f) => keepIds.includes(f.id));
      page.slices = [
        ...(page.slices ?? []).filter((s) => s.articleId !== articleId),
        { articleId, blockIds: keepIds, fragments: keptFragments.length ? keptFragments : undefined, fit: currentSlice?.fit },
      ];
      // Find or create the continuation page right after this page.
      const index = doc.pages.findIndex((p) => p.id === page.id);
      const next = doc.pages[index + 1];
      let target: DocumentPage;
      if (next && next.template === CONTINUATION_TEMPLATE && next.continuationOfPageId === page.id) {
        target = next;
      } else {
        target = {
          id: continuationIdFor(page.id, doc),
          number: page.number + 1,
          template: CONTINUATION_TEMPLATE,
          sectionId: page.sectionId,
          articleIds: [],
          mediaIds: [],
          continuationOf: page.number,
          isLocked: false,
          notes: null,
          continuationOfPageId: page.id,
          isContinuation: true,
          storyIds: page.storyIds,
          slices: [],
          imageScale: page.continuationImageScale,
          textScale: page.continuationTextScale,
        };
        doc.pages.splice(index + 1, 0, target);
        stats.added += 1;
      }
      const existing = target.slices?.find((s) => s.articleId === articleId);
      const mergedSlice: PageSlice = {
        articleId,
        blockIds: [...moveIds, ...(existing?.blockIds ?? []).filter((id) => !moveIds.includes(id))],
        fragments: [...movedFragments, ...(existing?.fragments ?? []).filter((f) => !movedFragments.some((m) => m.id === f.id))],
      };
      if (!mergedSlice.fragments?.length) delete mergedSlice.fragments;
      target.slices = [...(target.slices ?? []).filter((s) => s.articleId !== articleId), mergedSlice];
      if (!target.articleIds.includes(articleId)) target.articleIds.push(articleId);
      // Keep the article order of the continuation aligned with the source page.
      target.articleIds.sort((a, b) => page.articleIds.indexOf(a) - page.articleIds.indexOf(b));
      target.slices.sort((a, b) => page.articleIds.indexOf(a.articleId) - page.articleIds.indexOf(b.articleId));
      stats.moved += moveIds.length;
      changed = true;
    }
  }
  return changed;
}

/** One flow pass: reset, then move overflowing text down until nothing overflows. */
type FlowStats = { moved: number; split: number; added: number; copyfit: number; generation: number };

/**
 * Flow one candidate composition to a stable set of pages.
 *
 * Its `stats` are the work done on *this* attempt alone. The driver tries several compositions and
 * keeps one, so a shared counter would report the effort spent on discarded attempts as if it were
 * a property of the issue that ships — `continuationPagesAdded` would count pages that do not exist.
 */
async function flowDocument(
  input: EditionDocument,
  options: PaginateOptions,
  generation: { generation: number },
): Promise<{ document: EditionDocument; measures: PageMeasurement[]; rounds: number; stats: FlowStats }> {
  const stats: FlowStats = { moved: 0, split: 0, added: 0, copyfit: 0, generation: generation.generation };
  const maxRounds = options.maxRounds ?? 30;
  const log = options.log ?? (() => {});
  const doc = resetLayout(input);
  let rounds = 0;
  let measures: PageMeasurement[] = [];
  for (;;) {
    rounds += 1;
    renumberPages(doc);
    rebuildToc(doc);
    measures = await options.measure(options.render(doc));
    const overflowing = measures.filter((m) => m.flows.some((f) => f.overflow));
    log("layout round", { round: rounds, pages: doc.pages.length, overflowingPages: overflowing.map((m) => m.number) });
    if (!overflowing.length || rounds >= maxRounds) break;
    const changed = applyMeasurements(doc, measures, stats);
    if (!changed) break;
  }
  generation.generation = stats.generation;
  return { document: doc, measures, rounds, stats };
}

export type DensityChange = { page: number; pageId: string; lever: "image" | "text"; from: number; to: number; reason: string };

/**
 * Looks at a flowed issue and adjusts each page's bounded levers so the next pass composes better.
 *
 * Two moves, both the ones an art director would reach for first:
 *  · a continuation page that does not earn its paper → shrink the pictures on the page it came
 *    from (then, only if pictures cannot give enough, tighten its type) so the tail comes back up
 *    and the extra page disappears entirely;
 *  · a page left accidentally loose → grow its pictures into the gap, or set its type slightly
 *    larger when it has no picture to grow.
 *
 * Returns a copy with the levers moved; the caller re-flows from it. One step per page per pass
 * keeps the whole thing convergent.
 */
/**
 * Grows pages that were left accidentally loose: bigger pictures where there are pictures, slightly
 * larger type where there are none. One step per page per pass, and never on a page that is already
 * fighting for room, so the search converges.
 */
export function planLooseGrowth(doc: EditionDocument, measures: PageMeasurement[]): { document: EditionDocument; changes: DensityChange[] } {
  const out = clone(doc);
  const byId = new Map(out.pages.map((p) => [p.id, p]));
  const changes: DensityChange[] = [];
  const overflowed = new Set(measures.filter((m) => m.flows.some((f) => f.overflow)).map((m) => m.pageId));

  for (const measure of measures) {
    const page = byId.get(measure.pageId);
    if (!page || SPARSE_BY_DESIGN.has(page.template) || overflowed.has(page.id)) continue;
    const occupancy = measure.density?.occupancy ?? 1;
    const tailGap = measure.density?.tailGapRatio ?? 0;
    const underSet = measure.flows.some((f) => f.fillRatio < DENSITY.softFlowFill);
    const loose = occupancy < DENSITY.targetOccupancy.min && (tailGap > DENSITY.softTailGap || underSet);
    if (!loose) continue;

    if (measure.imageCount > 0) {
      const image = page.imageScale ?? 0;
      if (image > IMAGE_LEVEL_RANGE.min) {
        page.imageScale = image - 1;
        changes.push({ page: measure.number, pageId: page.id, lever: "image", from: image, to: image - 1, reason: `loose at ${Math.round(occupancy * 100)} %` });
        continue;
      }
    }
    const text = page.textScale ?? 0;
    if (text > FIT_LEVEL_RANGE.min) {
      page.textScale = text - 1;
      changes.push({ page: measure.number, pageId: page.id, lever: "text", from: text, to: text - 1, reason: `loose at ${Math.round(occupancy * 100)} %` });
    }
  }
  return { document: out, changes };
}

/**
 * Tries to make one sparse continuation page unnecessary.
 *
 * This is deliberately all-or-nothing. Nudging the source page one step at a time is worse than
 * useless: freeing a little room on the source means *less* text spills, so the continuation gets
 * emptier, not fuller. The only outcome worth having is the extra page disappearing, so the source's
 * levers go straight to the end of their travel — pictures first, then type as far as readability
 * allows — and the attempt is kept only if the page count actually drops without new overflow.
 */
export function planContinuationAbsorption(
  doc: EditionDocument,
  measures: PageMeasurement[],
  alreadyTried: Set<string>,
): { document: EditionDocument; changes: DensityChange[]; targetPageId: string } | null {
  const byNumber = new Map(measures.map((m) => [m.pageId, m]));
  const sparse = measures
    .filter((m) => m.template === CONTINUATION_TEMPLATE && (m.density?.occupancy ?? 1) < DENSITY.continuationFloor)
    .sort((a, b) => (a.density?.occupancy ?? 1) - (b.density?.occupancy ?? 1));

  for (const measure of sparse) {
    const page = doc.pages.find((p) => p.id === measure.pageId);
    const sourceId = page?.continuationOfPageId;
    if (!sourceId || alreadyTried.has(sourceId)) continue;
    const out = clone(doc);
    const source = out.pages.find((p) => p.id === sourceId);
    if (!source) continue;
    const changes: DensityChange[] = [];
    const image = source.imageScale ?? 0;
    const text = source.textScale ?? 0;
    // Pictures take the strain first; type moves only two steps (5 %), which stays readable.
    const targetImage = byNumber.get(sourceId)?.imageCount ? IMAGE_LEVEL_RANGE.max : image;
    const targetText = Math.min(FIT_LEVEL_RANGE.max, 2);
    if (targetImage === image && targetText <= text) continue;
    if (targetImage !== image) {
      source.imageScale = targetImage;
      changes.push({ page: measure.number, pageId: sourceId, lever: "image", from: image, to: targetImage, reason: `absorb continuation at ${Math.round((measure.density?.occupancy ?? 0) * 100)} %` });
    }
    if (targetText > text) {
      source.textScale = targetText;
      changes.push({ page: measure.number, pageId: sourceId, lever: "text", from: text, to: targetText, reason: "absorb continuation" });
    }
    if (!changes.length) continue;
    return { document: out, changes, targetPageId: sourceId };
  }
  return null;
}

/**
 * Makes a starved jump page earn its paper by giving its story more room, not less.
 *
 * The mirror of `planContinuationAbsorption`, and needed for the case that one cannot help: a story
 * of about one and a quarter pages, set tight, fills its first page and leaves the second nearly
 * blank. Squeezing the first page only makes the second emptier. What a magazine does is the
 * opposite — run the opening picture larger, set the type a little bigger — until the story reads
 * as the two-page piece it actually is. Both pages of the spread take the same levers, so it reads
 * as one piece rather than two settings of the same story.
 */
export function planSpreadJump(
  doc: EditionDocument,
  measures: PageMeasurement[],
  tried: Set<string>,
): { document: EditionDocument; changes: DensityChange[]; targetPageId: string } | null {
  const byId = new Map(measures.map((m) => [m.pageId, m]));
  const sparse = measures
    .filter((m) => m.template === CONTINUATION_TEMPLATE && (m.density?.occupancy ?? 1) < DENSITY.continuationFloor)
    .sort((a, b) => (a.density?.occupancy ?? 1) - (b.density?.occupancy ?? 1));

  for (const measure of sparse) {
    const page = doc.pages.find((p) => p.id === measure.pageId);
    const sourceId = page?.continuationOfPageId;
    if (!sourceId || tried.has(sourceId)) continue;
    const source = doc.pages.find((p) => p.id === sourceId);
    if (!source || source.isLocked || source.articleIds.length !== 1) continue;
    const image = source.imageScale ?? 0;
    const text = source.textScale ?? 0;
    const targetImage = byId.get(sourceId)?.imageCount ? IMAGE_LEVEL_RANGE.min : image;
    const targetText = FIT_LEVEL_RANGE.min;
    if (targetImage === image && targetText >= text) continue;
    const out = clone(doc);
    const target = out.pages.find((p) => p.id === sourceId);
    if (!target) continue;
    const changes: DensityChange[] = [];
    if (targetImage !== image) {
      target.imageScale = targetImage;
      changes.push({ page: measure.number, pageId: sourceId, lever: "image", from: image, to: targetImage, reason: `jump page at ${Math.round((measure.density?.occupancy ?? 0) * 100)} %` });
    }
    if (targetText < text) {
      target.textScale = targetText;
      changes.push({ page: measure.number, pageId: sourceId, lever: "text", from: text, to: targetText, reason: "spread a story over both pages" });
    }
    if (!changes.length) continue;
    target.continuationImageScale = targetImage;
    target.continuationTextScale = targetText;
    return { document: out, changes, targetPageId: sourceId };
  }
  return null;
}

export type TemplateSwap = { pageId: string; from: string; to: string; reason: string };

/**
 * Re-sets the story behind a sparse continuation in a denser layout variant.
 *
 * This is the move that actually removes most jump pages: a story allocated a big opening picture
 * spills a paragraph or two onto a page that then sits three-quarters empty, when the same story
 * set in two or three columns lands cleanly on one page. Candidates are tried from the least to the
 * most dense, so a story only loses its picture if it has to.
 */
export function planTemplateSwap(doc: EditionDocument, measures: PageMeasurement[], tried: Set<string>): { document: EditionDocument; swap: TemplateSwap } | null {
  const sparse = measures
    .filter((m) => m.template === CONTINUATION_TEMPLATE && (m.density?.occupancy ?? 1) < DENSITY.continuationFloor)
    .sort((a, b) => (a.density?.occupancy ?? 1) - (b.density?.occupancy ?? 1));

  for (const measure of sparse) {
    const page = doc.pages.find((p) => p.id === measure.pageId);
    const sourceId = page?.continuationOfPageId;
    if (!sourceId) continue;
    const source = doc.pages.find((p) => p.id === sourceId);
    if (!source || source.isLocked) continue;
    for (const candidate of TEMPLATE_ALTERNATIVES[source.template] ?? []) {
      const key = `${sourceId}:${candidate}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const out = clone(doc);
      const target = out.pages.find((p) => p.id === sourceId);
      if (!target) continue;
      const from = target.template;
      target.template = candidate;
      return { document: out, swap: { pageId: sourceId, from, to: candidate, reason: `continuation ${Math.round((measure.density?.occupancy ?? 0) * 100)} % full` } };
    }
  }
  return null;
}

/**
 * Fills the empty tail of a jump page with the story that follows it.
 *
 * Some articles genuinely need more than one page: no variant and no resizing can make 1.3 pages of
 * text fit on one. What a magazine never does is leave the second page three-quarters blank — it
 * starts the next story underneath. So the following page's article is moved onto the jump page and
 * its own page removed; whatever does not fit flows on as usual, but now behind a page that is full.
 */
/**
 * Whether a page can take one more story without losing it.
 *
 * Two ways a page cannot. A contents page, a cover and every single-story template print the first
 * article placed on them and silently ignore the rest. And a jump page is not a place at all: every
 * flow pass rebuilds jump pages from what actually overflows, so a story moved onto one is thrown
 * away with the page before it is ever set — which is how two stories disappeared out of an issue
 * that still reported itself clean. A starved jump page is dealt with by `planUnsplitJump`, which
 * turns it into a real page first.
 */
function canHostAnotherStory(page: DocumentPage): boolean {
  if (page.template === CONTINUATION_TEMPLATE) return false;
  const limit = MULTI_STORY_TEMPLATES[page.template];
  return !!limit && page.articleIds.length < limit;
}

export function planTailFill(doc: EditionDocument, measures: PageMeasurement[], tried: Set<string>): { document: EditionDocument; moved: { pageId: string; articleId: string } } | null {
  const measureById = new Map(measures.map((m) => [m.pageId, m]));
  for (const [index, page] of doc.pages.entries()) {
    // Any page with room to spare, not only a jump page. Limiting this to continuations was the
    // reason an ordinary page could sit at a quarter full with a finished story on the next sheet:
    // nothing in the engine was allowed to move that story up.
    if (SPARSE_BY_DESIGN.has(page.template) || page.isLocked) continue;
    const measure = measureById.get(page.id);
    const occupancy = measure?.density?.occupancy ?? 1;
    const floor = page.template === CONTINUATION_TEMPLATE ? DENSITY.continuationFloor : DENSITY.hardOccupancyFloor;
    if (occupancy >= floor) continue;
    if (tried.has(page.id)) continue;

    const next = doc.pages[index + 1];
    if (!next || next.isLocked) continue;
    // Only absorb a plain, single-story article page — never a cover, opener, contents or a
    // structured page whose shape carries meaning, and never another jump page.
    if (next.template === CONTINUATION_TEMPLATE || SPARSE_BY_DESIGN.has(next.template)) continue;
    // A plain article page, or a news page: both are made to be re-set elsewhere. A structured page
    // — a case study, an event — carries its meaning in its shape and stays where it is.
    if (!(TEMPLATE_ALTERNATIVES[next.template] ?? []).length && next.template !== "ARTICLE_THREE_COLUMN" && !MULTI_STORY_TEMPLATES[next.template]) continue;
    if (next.articleIds.length !== 1) continue;
    if (!canHostAnotherStory(page)) continue;
    const articleId = next.articleIds[0];
    const article = doc.articles.find((a) => a.id === articleId);
    if (!article || !article.body.length) continue;

    tried.add(page.id);
    const out = clone(doc);
    const target = out.pages.find((p) => p.id === page.id);
    const victim = out.pages.find((p) => p.id === next.id);
    if (!target || !victim) continue;
    target.articleIds = [...target.articleIds, articleId];
    target.slices = [...(target.slices ?? []), { articleId, blockIds: article.body.map((b) => b.id) }];
    target.mediaIds = [...target.mediaIds, ...victim.mediaIds];
    out.pages = out.pages.filter((p) => p.id !== victim.id);
    return { document: out, moved: { pageId: page.id, articleId } };
  }
  return null;
}

/**
 * Stops splitting a story that only trickles onto its jump page.
 *
 * When a news page carries three stories and the third spills four paragraphs, the issue ends up
 * with a page at a fifth full — the worst-looking page in the magazine, and the one no amount of
 * resizing can save, because there is nothing on it to resize. The fix is to stop splitting: the
 * story leaves the shared page entirely and gets the following sheet to itself. The issue keeps its
 * page count, the shared page has more room for the stories that remain, and the story that was cut
 * in two is whole again.
 *
 * The new sheet is a real page, not a jump page: every flow pass rebuilds jump pages from what
 * actually overflows, so a story parked on one would simply vanish from the issue.
 */
export function planUnsplitJump(
  doc: EditionDocument,
  measures: PageMeasurement[],
  tried: Set<string>,
): { document: EditionDocument; moved: { pageId: string; articleId: string } } | null {
  const sparse = measures
    .filter((m) => m.template === CONTINUATION_TEMPLATE && (m.density?.occupancy ?? 1) < DENSITY.continuationFloor)
    .sort((a, b) => (a.density?.occupancy ?? 1) - (b.density?.occupancy ?? 1));

  for (const measure of sparse) {
    const page = doc.pages.find((p) => p.id === measure.pageId);
    const slices = page?.slices ?? [];
    if (!page || page.isLocked || slices.length !== 1) continue;
    const articleId = slices[0].articleId;
    const source = doc.pages.find((p) => p.id === page.continuationOfPageId);
    // Only worth doing when the source page has other stories to spread into the room freed.
    if (!source || source.isLocked || source.articleIds.length < 2) continue;
    const article = doc.articles.find((a) => a.id === articleId);
    if (!article || !article.body.length) continue;
    const key = `${source.id}:${articleId}`;
    if (tried.has(key)) continue;
    tried.add(key);

    const out = clone(doc);
    const src = out.pages.find((p) => p.id === source.id);
    if (!src) continue;
    src.articleIds = src.articleIds.filter((id) => id !== articleId);
    src.slices = (src.slices ?? []).filter((s) => s.articleId !== articleId);
    // A news item keeps the family it was set in; anything else opens as a plain article page.
    const template = source.template !== CONTINUATION_TEMPLATE && MULTI_STORY_TEMPLATES[source.template] ? source.template : "ARTICLE_TWO_COLUMN";
    const index = out.pages.findIndex((p) => p.id === source.id);
    out.pages.splice(index + 1, 0, {
      id: `unsplit_${articleId}`,
      number: source.number + 1,
      template,
      sectionId: source.sectionId,
      articleIds: [articleId],
      mediaIds: [],
      continuationOf: null,
      continuationOfPageId: null,
      isContinuation: false,
      isLocked: false,
      notes: null,
      storyIds: [article.storyId],
    });
    return { document: out, moved: { pageId: `unsplit_${articleId}`, articleId } };
  }
  return null;
}

/**
 * Scores a flowed issue so competing density passes can be compared: lower is better.
 *
 * Two weights carry the editorial judgement. A jump page is charged by how empty it is, not at a
 * flat rate, because a jump page at a fifth full is the defect readers actually notice and one at
 * half is merely tight. And a sheet of paper is charged enough to matter — it has to be cheaper to
 * print one more page than to leave a nearly blank one, but only just.
 */
function densityCost(measures: PageMeasurement[]): number {
  let cost = 0;
  for (const m of measures) {
    if (m.flows.some((f) => f.overflow)) cost += 100;
    const occupancy = m.density?.occupancy ?? 1;
    const isContinuation = m.template === CONTINUATION_TEMPLATE;
    if (SPARSE_BY_DESIGN.has(m.template)) continue;
    if (isContinuation && occupancy < DENSITY.continuationFloor) cost += 30 + (DENSITY.continuationFloor - occupancy) * 60;
    if (occupancy < DENSITY.targetOccupancy.min) cost += (DENSITY.targetOccupancy.min - occupancy) * 20;
  }
  return cost + measures.length * 2;
}

export async function paginateDocument(input: EditionDocument, options: PaginateOptions): Promise<{ document: EditionDocument; report: LayoutReport; measures: PageMeasurement[] }> {
  const log = options.log ?? (() => {});
  /**
   * A budget per stage, sized to the issue.
   *
   * There used to be one pool of six shared by four stages, and the first stage spent five of them
   * on a 25-page issue: the passes that fill a loose page never ran at all. Each stage now gets its
   * own allowance, and a longer issue gets more, because the number of pages that can be wrong
   * grows with the number of pages.
   */
  const perStage = options.densityPasses ?? Math.max(6, Math.ceil(input.pages.length / 2));
  const plannedPages = input.pages.length;
  /**
   * A fixed extent is a promise, so the passes that shorten an issue are not allowed to break it.
   *
   * Every stage below is free to move stories about and to resize pictures and type — that is how a
   * fixed issue gets filled rather than padded — but a composition with fewer sheets than were
   * bought is rejected out of hand. Nothing here can add a sheet the copy does not need, so an
   * issue planned to its extent stays at its extent.
   */
  const extent = input.meta.extent;
  const floorPages = extent?.mode === "fixed" && extent.pages ? Math.min(extent.pages, plannedPages) : 0;
  const keepsExtent = (doc: EditionDocument) => doc.pages.length >= floorPages;

  /**
   * No pass may lose a story. Ever.
   *
   * Every stage below moves stories between pages, and a move that quietly leaves one on no page
   * at all takes it out of the magazine — the reader never sees it and nothing in the report says
   * so. The invariant is checked on the result of each candidate rather than trusted to the move
   * that made it, because it is the one kind of mistake there is no recovering from.
   */
  const placed = (doc: EditionDocument) => new Set(doc.pages.flatMap((p) => p.articleIds));
  const everyStoryPlaced = new Set(input.articles.map((a) => a.id));
  const keepsEveryStory = (doc: EditionDocument) => {
    const after = placed(doc);
    const lost = [...everyStoryPlaced].filter((id) => !after.has(id) && placed(input).has(id));
    if (lost.length) log("pass rejected: it would drop a story", { articles: lost });
    return lost.length === 0;
  };
  const sound = (doc: EditionDocument) => keepsExtent(doc) && keepsEveryStory(doc);
  const generation = { generation: 0 };

  const first = await flowDocument(input, options, generation);
  let rounds = first.rounds;
  let best = { document: first.document, measures: first.measures, stats: first.stats, cost: densityCost(first.measures) };
  const applied: DensityChange[] = [];
  let passes = 0;

  // ── stage 0 · re-set a spilling story in a denser layout variant ──
  // Changing the composition comes before resizing anything: a story that needs two columns rather
  // than a full-width opening picture keeps its type and its pictures at their natural size.
  const triedTemplates = new Set<string>();
  const swaps: TemplateSwap[] = [];
  let stage = 0;
  for (;;) {
    if (stage >= perStage) break;
    const attempt = planTemplateSwap(best.document, best.measures, triedTemplates);
    if (!attempt) break;
    passes += 1;
    stage += 1;
    const next = await flowDocument(attempt.document, options, generation);
    rounds += next.rounds;
    const fewerPages = next.document.pages.length < best.document.pages.length;
    const clean = !next.measures.some((m) => m.flows.some((f) => f.overflow));
    // Judged on the whole issue, not only on whether a page disappeared. A story re-set in two
    // columns that spills one paragraph instead of five leaves the same number of sheets but not
    // the same magazine, and insisting on a page being removed was why a jump page could sit at a
    // third full with a denser variant of the same story available.
    const cost = densityCost(next.measures);
    const better = (fewerPages || cost < best.cost) && sound(next.document);
    log("variant pass", { pass: passes, swap: `${attempt.swap.from}→${attempt.swap.to}`, pages: next.document.pages.length, was: best.document.pages.length, cost: Math.round(cost * 10) / 10, was_cost: Math.round(best.cost * 10) / 10, fewerPages, clean, better });
    if (better && clean) {
      best = { document: next.document, measures: next.measures, stats: next.stats, cost };
      swaps.push(attempt.swap);
    }
  }

  // ── stage 1 · absorb continuation pages that do not earn their paper ──
  // Each attempt is judged on one question only: did the issue lose a page without gaining overflow?
  const tried = new Set<string>();
  const absorbStage = async (label: string) => {
    // Each run starts with a clean slate: an absorption that failed against an earlier composition
    // says nothing about the one that stands now.
    tried.clear();
    let used = 0;
    for (;;) {
      if (used >= perStage) break;
      const attempt = planContinuationAbsorption(best.document, best.measures, tried);
      if (!attempt) break;
      tried.add(attempt.targetPageId);
      passes += 1;
      used += 1;
      const next = await flowDocument(attempt.document, options, generation);
      rounds += next.rounds;
      const absorbed = next.document.pages.length < best.document.pages.length;
      const clean = !next.measures.some((m) => m.flows.some((f) => f.overflow));
      log(label, { pass: passes, pages: next.document.pages.length, was: best.document.pages.length, absorbed, clean });
      if (absorbed && clean && sound(next.document)) {
        best = { document: next.document, measures: next.measures, stats: next.stats, cost: densityCost(next.measures) };
        applied.push(...attempt.changes);
      }
    }
  };
  await absorbStage("absorb pass");

  // ── stage 1b · fill what is left of a loose page with the story that follows ──
  const triedFills = new Set<string>();
  const tailFillStage = async (label: string) => {
    let used = 0;
    for (;;) {
      if (used >= perStage) break;
      const attempt = planTailFill(best.document, best.measures, triedFills);
      if (!attempt) break;
      passes += 1;
      used += 1;
      const next = await flowDocument(attempt.document, options, generation);
      rounds += next.rounds;
      const clean = !next.measures.some((m) => m.flows.some((f) => f.overflow));
      // Judged on the score alone, which already prices a sheet of paper: pulling a story up is not
      // worth it when all it buys is a jump page at a fifth full where a whole page used to be.
      const cost = densityCost(next.measures);
      const better = cost < best.cost && sound(next.document);
      log(label, { pass: passes, pages: next.document.pages.length, was: best.document.pages.length, cost: Math.round(cost * 10) / 10, was_cost: Math.round(best.cost * 10) / 10, clean, better });
      if (clean && better) {
        best = { document: next.document, measures: next.measures, stats: next.stats, cost };
        // The issue has changed, so a page this stage rejected earlier deserves another look: what
        // could not be pulled up behind a different neighbour may travel now.
        triedFills.clear();
      }
    }
  };
  await tailFillStage("tail-fill pass");

  // ── stage 1c · absorb again ──
  // Pulling a story up onto a loose page often leaves the tail of that story on a new jump page.
  // The absorption stage is exactly the tool for that, so it runs once more now that it has
  // something to work on; the first run had no way of knowing these pages would exist.
  await absorbStage("absorb pass (after fill)");

  // ── stage 1d · stop splitting a story that only trickles onto its jump page ──
  const triedUnsplit = new Set<string>();
  const unsplitStage = async (label: string) => {
    let used = 0;
    for (;;) {
      if (used >= perStage) break;
      const attempt = planUnsplitJump(best.document, best.measures, triedUnsplit);
      if (!attempt) break;
      passes += 1;
      used += 1;
      const next = await flowDocument(attempt.document, options, generation);
      rounds += next.rounds;
      const clean = !next.measures.some((m) => m.flows.some((f) => f.overflow));
      const cost = densityCost(next.measures);
      const better = cost < best.cost && sound(next.document);
      log(label, { pass: passes, pages: next.document.pages.length, was: best.document.pages.length, cost: Math.round(cost * 10) / 10, was_cost: Math.round(best.cost * 10) / 10, clean, better });
      if (clean && better) {
        best = { document: next.document, measures: next.measures, stats: next.stats, cost };
      }
    }
  };
  // ── stage 1d2 · a jump page that nothing could remove is made to earn its paper ──
  const triedSpread = new Set<string>();
  const spreadStage = async (label: string) => {
    let used = 0;
    for (;;) {
      if (used >= perStage) break;
      const attempt = planSpreadJump(best.document, best.measures, triedSpread);
      if (!attempt) break;
      triedSpread.add(attempt.targetPageId);
      passes += 1;
      used += 1;
      const next = await flowDocument(attempt.document, options, generation);
      rounds += next.rounds;
      const clean = !next.measures.some((m) => m.flows.some((f) => f.overflow));
      const cost = densityCost(next.measures);
      const better = cost < best.cost && sound(next.document);
      log(label, { pass: passes, pages: next.document.pages.length, was: best.document.pages.length, cost: Math.round(cost * 10) / 10, was_cost: Math.round(best.cost * 10) / 10, clean, better });
      if (clean && better) {
        best = { document: next.document, measures: next.measures, stats: next.stats, cost };
        applied.push(...attempt.changes);
      }
    }
  };

  /*
   * Un-splitting, spreading and filling are each other's work.
   *
   * Pulling a story up leaves the tail of it on a new jump page, which un-splitting turns into a
   * real page, which has room the fill stage can use — and round it goes. Running each once, in a
   * fixed order, left whatever the last of them did unanswered: an issue ended with a jump page at
   * two fifths and a shorts page at a third, both of them made by the pass that ran last. So the
   * three repeat until a round buys nothing, which on a normal issue is the second or the third.
   */
  for (let round = 0; round < 3; round += 1) {
    const before = best.cost;
    triedUnsplit.clear();
    triedSpread.clear();
    triedFills.clear();
    const suffix = round ? ` (round ${round + 1})` : "";
    await unsplitStage(`unsplit pass${suffix}`);
    await spreadStage(`spread pass${suffix}`);
    await tailFillStage(`tail-fill pass${suffix || " (after unsplit)"}`);
    if (best.cost >= before) break;
  }

  // ── stage 2 · grow the pages that are merely loose ──
  stage = 0;
  while (stage < perStage) {
    const plan = planLooseGrowth(best.document, best.measures);
    if (!plan.changes.length) break;
    passes += 1;
    stage += 1;
    const next = await flowDocument(plan.document, options, generation);
    rounds += next.rounds;
    const cost = densityCost(next.measures);
    log("growth pass", { pass: passes, changes: plan.changes.length, cost: Math.round(cost * 10) / 10, best: Math.round(best.cost * 10) / 10 });
    if (cost >= best.cost || !sound(next.document)) break; // no further gain — keep the best composition
    best = { document: next.document, measures: next.measures, stats: next.stats, cost };
    applied.push(...plan.changes);
  }

  const doc = best.document;
  renumberPages(doc);
  rebuildToc(doc);
  // Continuation pages are a fact about the issue that ships, not a tally of attempts made.
  const stats = { ...best.stats, added: doc.pages.filter((p) => p.template === "CONTINUATION").length };
  doc.meta.layout = { paginatedAt: new Date().toISOString(), continuationPages: stats.added, engine: options.engine ?? "chromium-multicol" };
  const report = buildLayoutReport(doc, best.measures, { plannedPages, stats, rounds, engine: options.engine ?? "chromium-multicol", densityPasses: passes, densityChanges: applied, templateSwaps: swaps });
  return { document: doc, report, measures: best.measures };
}

export function buildLayoutReport(
  doc: EditionDocument,
  measures: PageMeasurement[],
  extra: {
    plannedPages: number;
    stats: { moved: number; split: number; added: number; copyfit: number };
    rounds: number;
    engine: string;
    pageCountMismatch?: { expected: number; actual: number };
    densityPasses?: number;
    densityChanges?: DensityChange[];
    templateSwaps?: TemplateSwap[];
    mediaMissing?: string[];
  },
): LayoutReport {
  const remainingOverflow = measures.flatMap((m) =>
    m.flows.filter((f) => f.overflow).map((f) => ({ page: m.number, pageId: m.pageId, articleId: f.articleId, blocks: f.blocks.filter((b) => !b.fits).map((b) => b.id) })),
  );
  const blankPages = measures.filter((m) => m.blank).map((m) => m.number);
  const underfilled = measures
    .filter((m) => {
      if (SPARSE_BY_DESIGN.has(m.template) || LOOSE_ALLOWED.has(m.template)) return false;
      const occupancy = m.density?.occupancy ?? 1;
      return occupancy < (m.template === CONTINUATION_TEMPLATE ? DENSITY.continuationFloor : DENSITY.hardOccupancyFloor);
    })
    .map((m) => ({ page: m.number, template: m.template, occupancy: Math.round((m.density?.occupancy ?? 0) * 100) / 100 }));
  const imagesFailed = measures.flatMap((m) => m.imagesFailed.map((mediaId) => ({ page: m.number, mediaId })));
  const mediaMissing = extra.mediaMissing ?? [];
  const extentTarget = doc.meta.extent?.mode === "fixed" ? (doc.meta.extent.pages ?? 0) : 0;
  const extentMissed = extentTarget && doc.pages.length !== extentTarget ? ({ mode: "fixed", target: extentTarget, actual: doc.pages.length } as const) : undefined;
  const fit = measures.flatMap((m) => m.flows.map((f) => ({ page: m.number, pageId: m.pageId, template: m.template, articleId: f.articleId, ratio: f.fillRatio })));
  return {
    ok: remainingOverflow.length === 0 && blankPages.length === 0 && imagesFailed.length === 0 && underfilled.length === 0 && mediaMissing.length === 0 && !extra.pageCountMismatch && !extentMissed,
    pages: doc.pages.length,
    plannedPages: extra.plannedPages,
    continuationPagesAdded: extra.stats.added,
    blocksMoved: extra.stats.moved,
    paragraphsSplit: extra.stats.split,
    copyfitFlows: extra.stats.copyfit,
    rounds: extra.rounds,
    remainingOverflow,
    blankPages,
    underfilled,
    imagesFailed,
    mediaMissing,
    extentMissed,
    fit,
    pageCountMismatch: extra.pageCountMismatch,
    engine: extra.engine,
    densityPasses: extra.densityPasses,
    densityChanges: extra.densityChanges,
    templateSwaps: extra.templateSwaps,
    density: measures.map((m) => ({ page: m.number, template: m.template, occupancy: m.density?.occupancy ?? 0, tailGap: m.density?.tailGapRatio ?? 0 })),
  };
}
