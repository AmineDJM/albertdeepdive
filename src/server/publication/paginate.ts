import type { ArticleBlock, DocumentPage, EditionDocument, PageSlice } from "@/lib/publication/document";
import { splitParagraphAtSentence } from "@/lib/publication/text";

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
};

export type PaginateOptions = {
  render: (doc: EditionDocument) => string;
  measure: (html: string) => Promise<PageMeasurement[]>;
  maxRounds?: number;
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

export async function paginateDocument(input: EditionDocument, options: PaginateOptions): Promise<{ document: EditionDocument; report: LayoutReport; measures: PageMeasurement[] }> {
  const maxRounds = options.maxRounds ?? 30;
  const log = options.log ?? (() => {});
  const doc = resetLayout(input);
  const plannedPages = doc.pages.length;
  const stats = { moved: 0, split: 0, added: 0, copyfit: 0, generation: 0 };
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
  renumberPages(doc);
  rebuildToc(doc);
  doc.meta.layout = { paginatedAt: new Date().toISOString(), continuationPages: stats.added, engine: options.engine ?? "chromium-multicol" };
  const report = buildLayoutReport(doc, measures, { plannedPages, stats, rounds, engine: options.engine ?? "chromium-multicol" });
  return { document: doc, report, measures };
}

export function buildLayoutReport(
  doc: EditionDocument,
  measures: PageMeasurement[],
  extra: { plannedPages: number; stats: { moved: number; split: number; added: number; copyfit: number }; rounds: number; engine: string; pageCountMismatch?: { expected: number; actual: number } },
): LayoutReport {
  const remainingOverflow = measures.flatMap((m) =>
    m.flows.filter((f) => f.overflow).map((f) => ({ page: m.number, pageId: m.pageId, articleId: f.articleId, blocks: f.blocks.filter((b) => !b.fits).map((b) => b.id) })),
  );
  const blankPages = measures.filter((m) => m.blank).map((m) => m.number);
  const imagesFailed = measures.flatMap((m) => m.imagesFailed.map((mediaId) => ({ page: m.number, mediaId })));
  const fit = measures.flatMap((m) => m.flows.map((f) => ({ page: m.number, pageId: m.pageId, template: m.template, articleId: f.articleId, ratio: f.fillRatio })));
  return {
    ok: remainingOverflow.length === 0 && blankPages.length === 0 && imagesFailed.length === 0 && !extra.pageCountMismatch,
    pages: doc.pages.length,
    plannedPages: extra.plannedPages,
    continuationPagesAdded: extra.stats.added,
    blocksMoved: extra.stats.moved,
    paragraphsSplit: extra.stats.split,
    copyfitFlows: extra.stats.copyfit,
    rounds: extra.rounds,
    remainingOverflow,
    blankPages,
    imagesFailed,
    fit,
    pageCountMismatch: extra.pageCountMismatch,
    engine: extra.engine,
  };
}
