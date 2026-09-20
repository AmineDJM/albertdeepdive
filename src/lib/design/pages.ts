import { designId, type DesignBlock, type DesignElement, type DesignSurface, type EditionDesign } from "./model";
import type { SurfaceKind } from "./roles";

/**
 * The design, resolved into pages.
 *
 * A surface is a unit of composition — a cover, an opener, a run of stories — and says nothing
 * about paper. Print is the medium that has to answer "and where does it stop?", so this is where
 * surfaces become numbered sheets with a left and a right side, where a story that runs long is
 * carried over, and where the constraints the composition stated (`atomic`, `keepTogether`,
 * `keepWithNext`, `avoidBreakBefore`) are finally enforced rather than merely recorded.
 *
 * Everything here is pure. A page plan is produced from a design without a browser, then a
 * measuring pass hands back what actually overflowed and the same pure operations — reflow,
 * absorb, tighten — move the plan one honest step. That split is what makes print reproducible:
 * the same design, the same measurements and the same code give the same pages every time.
 */

export type PageSize = { widthMm: number; heightMm: number; label: string };

export const PAGE_SIZES = {
  a4: { widthMm: 210, heightMm: 297, label: "A4" },
  a5: { widthMm: 148, heightMm: 210, label: "A5" },
  letter: { widthMm: 215.9, heightMm: 279.4, label: "Letter" },
  tabloid: { widthMm: 279.4, heightMm: 431.8, label: "Tabloid" },
  square: { widthMm: 210, heightMm: 210, label: "Square" },
} as const satisfies Record<string, PageSize>;

export type PageSizeName = keyof typeof PAGE_SIZES;

/** Copyfit steps, 2.5 % of type and leading each. Positive tightens; a page never grows past 0. */
export const FIT_STEPS = { min: 0, max: 4 } as const;

/**
 * One surface's appearance on one page.
 *
 * A surface that runs over the page turn appears twice: once with `continues`, once with
 * `continued`. Keeping the surface id on both is what lets the jump line say where a story went
 * and the critic say that a quote was broken in half.
 */
export type PageSurface = {
  surfaceId: string;
  sectionId: string;
  sectionName: string;
  kind: SurfaceKind;
  blocks: DesignBlock[];
  continued: boolean;
  continues: boolean;
  intent: string | null;
};

export type PrintPage = {
  id: string;
  number: number;
  surfaces: PageSurface[];
  /** May never be broken: a cover, an opener, a designed spread. */
  atomic: boolean;
  /** Copyfit steps applied to this page, 0 when the page was never tight. */
  fit: number;
  side: "left" | "right";
  /** A page on the paper with nothing on it, inserted so the next opener falls on a right-hand page. */
  blank: boolean;
};

/**
 * A promise the paper could not keep.
 *
 * An atomic surface that still overflows after every legitimate move has two possible endings: a
 * page that spills off the sheet, or a block moved off it. The second is better and neither is
 * free, so it is recorded — the critic reads this, and so does the person asking why the pull
 * quote is on the next page.
 */
export type Relaxation = { surfaceId: string; blockId: string; fromPage: number; reason: string };

export type PrintPlan = {
  editionId: string;
  revision: number;
  size: PageSize;
  pages: PrintPage[];
  /** The page a story starts on — the contents, and the jump lines, both read this. */
  pageOfArticle: Record<string, number>;
  pageOfBlock: Record<string, number>;
  /** Whether openers are held back to a right-hand page, which costs blank paper. */
  openersOnRight: boolean;
  startOn: "left" | "right";
  /** Where the engine had to overrule the design, and why. */
  relaxations: Relaxation[];
};

export type PrintOptions = {
  size?: PageSizeName | PageSize;
  /** Which side the first page falls on. A saddle-stitched issue opens on the right. */
  startOn?: "left" | "right";
  /** Hold openers and spreads back to a right-hand page, at the cost of a blank verso. */
  openersOnRight?: boolean;
};

export function sizeOf(size: PrintOptions["size"]): PageSize {
  if (!size) return PAGE_SIZES.a4;
  return typeof size === "string" ? PAGE_SIZES[size] : size;
}

/** Surfaces that are a page in themselves whatever else would fit beside them. */
const WHOLE_PAGE: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>(["cover", "opener", "spread", "close"]);

/** Surfaces that want the right-hand side of a spread, when the publication asks for that. */
const WANTS_RECTO: ReadonlySet<SurfaceKind> = new Set<SurfaceKind>(["cover", "opener", "spread"]);

function pageSurfaceOf(surface: DesignSurface, sectionId: string, sectionName: string): PageSurface {
  return {
    surfaceId: surface.id,
    sectionId,
    sectionName,
    kind: surface.kind,
    blocks: surface.blocks,
    continued: false,
    continues: false,
    intent: surface.intent,
  };
}

function isAtomic(surface: PageSurface, design: EditionDesign): boolean {
  const declared = design.sections.flatMap((s) => s.surfaces).find((s) => s.id === surface.surfaceId)?.atomic;
  return Boolean(declared) || WHOLE_PAGE.has(surface.kind);
}

/**
 * The first plan: one surface, one page.
 *
 * Deliberately naive, because the honest answer to "does this fit?" comes from a browser and not
 * from arithmetic over character counts. What this pass gets right is the order, the atomicity and
 * the numbering; the measuring loop gets the rest.
 */
export function planPrint(design: EditionDesign, options: PrintOptions = {}): PrintPlan {
  const pages: PrintPage[] = [];
  for (const section of design.sections) {
    for (const surface of section.surfaces) {
      if (!surface.blocks.length) continue;
      const pageSurface = pageSurfaceOf(surface, section.id, section.name);
      pages.push({
        id: designId("pg"),
        number: 0,
        surfaces: [pageSurface],
        atomic: Boolean(surface.atomic) || WHOLE_PAGE.has(surface.kind),
        fit: 0,
        side: "right",
        blank: false,
      });
    }
  }
  return renumber({
    editionId: design.editionId,
    revision: design.revision,
    size: sizeOf(options.size),
    pages,
    pageOfArticle: {},
    pageOfBlock: {},
    openersOnRight: options.openersOnRight ?? false,
    startOn: options.startOn ?? "right",
    relaxations: [],
  });
}

/* ── Numbering, which is also where blank pages are earned ───────────────────────────────── */

function blankPage(): PrintPage {
  return { id: designId("pg"), number: 0, surfaces: [], atomic: true, fit: 0, side: "left", blank: true };
}

/**
 * Numbers, sides, and where every story can be found.
 *
 * Run after every change, because a page inserted in the middle moves the folio of everything
 * after it — and a jump line that says "continued on page 9" when the story moved to page 11 is
 * worse than no jump line.
 */
export function renumber(plan: PrintPlan): PrintPlan {
  const first = plan.startOn === "right" ? 1 : 2;
  const pages: PrintPage[] = [];
  for (const page of plan.pages) {
    if (page.blank) continue; // blanks are re-earned below, never accumulated
    const number = first + pages.length;
    const wantsRecto = plan.openersOnRight && page.surfaces.some((s) => WANTS_RECTO.has(s.kind) && !s.continued);
    if (wantsRecto && number % 2 === 0) pages.push({ ...blankPage(), number, side: sideOf(number) });
    const assigned = first + pages.length;
    pages.push({ ...page, number: assigned, side: sideOf(assigned) });
  }
  const pageOfArticle: Record<string, number> = {};
  const pageOfBlock: Record<string, number> = {};
  for (const page of pages) {
    for (const surface of page.surfaces) {
      for (const block of surface.blocks) {
        pageOfBlock[block.id] = page.number;
        if (block.articleId && pageOfArticle[block.articleId] === undefined) pageOfArticle[block.articleId] = page.number;
      }
    }
  }
  return { ...plan, pages, pageOfArticle, pageOfBlock };
}

function sideOf(number: number): "left" | "right" {
  return number % 2 === 1 ? "right" : "left";
}

/* ── Reading a plan ──────────────────────────────────────────────────────────────────────── */

export function pagesOf(plan: PrintPlan): PrintPage[] {
  return plan.pages;
}

export function blocksOnPage(page: PrintPage): DesignBlock[] {
  return page.surfaces.flatMap((surface) => surface.blocks);
}

export function findPage(plan: PrintPlan, pageId: string): PrintPage | null {
  return plan.pages.find((page) => page.id === pageId) ?? null;
}

/** Where a surface's tail went, for the jump line on the page it left. */
export function jumpTarget(plan: PrintPlan, pageId: string, surfaceId: string): number | null {
  const index = plan.pages.findIndex((page) => page.id === pageId);
  if (index < 0) return null;
  for (const page of plan.pages.slice(index + 1)) {
    if (page.surfaces.some((surface) => surface.surfaceId === surfaceId && surface.continued)) return page.number;
  }
  return null;
}

/** The page a carried-over surface came from, for the "continued from" line. */
export function jumpSource(plan: PrintPlan, pageId: string, surfaceId: string): number | null {
  const index = plan.pages.findIndex((page) => page.id === pageId);
  if (index < 0) return null;
  for (const page of [...plan.pages.slice(0, index)].reverse()) {
    if (page.surfaces.some((surface) => surface.surfaceId === surfaceId)) return page.number;
  }
  return null;
}

/* ── The moves ───────────────────────────────────────────────────────────────────────────── */

/**
 * Where a page may legitimately be cut.
 *
 * The measuring pass says which blocks fit; the break rules say whether the cut it implies is one
 * an editor would accept. A heading marked `keepWithNext` pulls the cut back above itself rather
 * than being left alone at the foot of a page, and a block that may not open a page pulls it back
 * too. The one thing this will not do is return zero: a page with nothing on it is not a fix.
 */
export function breakPoint(blocks: DesignBlock[], fitting: ReadonlySet<string>, floor = 1): number {
  let index = 0;
  while (index < blocks.length && fitting.has(blocks[index].id)) index += 1;
  if (index >= blocks.length) return blocks.length;
  while (index > floor) {
    const previous = blocks[index - 1];
    const next = blocks[index];
    if (previous.constraints.keepWithNext || next.constraints.avoidBreakBefore) index -= 1;
    else break;
  }
  return Math.max(floor, index);
}

export type Reflow = { plan: PrintPlan; moved: string[]; addedPageId: string };

/**
 * Carry what did not fit onto a page of its own.
 *
 * The tail keeps the surface it came from, so the two halves of a story still know they are one
 * story. An atomic page never reflows — a cover cannot be continued — and is tightened instead.
 */
export function reflow(plan: PrintPlan, pageId: string, fitting: ReadonlySet<string>): Reflow | null {
  const index = plan.pages.findIndex((page) => page.id === pageId);
  if (index < 0) return null;
  const page = plan.pages[index];
  if (page.atomic || page.blank) return null;

  const head: PageSurface[] = [];
  const tail: PageSurface[] = [];
  const moved: string[] = [];
  let spilling = false;
  for (const surface of page.surfaces) {
    if (spilling) {
      tail.push({ ...surface, continued: false });
      moved.push(...surface.blocks.map((block) => block.id));
      continue;
    }
    // A surface that is not the first on the page may leave it entirely; the first may not, or the
    // page would be left with nothing on it.
    const cut = breakPoint(surface.blocks, fitting, head.length ? 0 : 1);
    if (cut >= surface.blocks.length) {
      head.push(surface);
      continue;
    }
    spilling = true;
    if (cut === 0) {
      tail.push({ ...surface, continued: false });
      moved.push(...surface.blocks.map((block) => block.id));
      continue;
    }
    const kept = surface.blocks.slice(0, cut);
    const carried = surface.blocks.slice(cut);
    moved.push(...carried.map((block) => block.id));
    head.push({ ...surface, blocks: kept, continues: true });
    tail.push({ ...surface, blocks: carried, continued: true, continues: surface.continues });
  }
  if (!tail.length || !head.length) return null;

  const added: PrintPage = { id: designId("pg"), number: 0, surfaces: tail, atomic: false, fit: page.fit, side: "left", blank: false };
  const pages = [...plan.pages.slice(0, index), { ...page, surfaces: head }, added, ...plan.pages.slice(index + 1)];
  return { plan: renumber({ ...plan, pages }), moved, addedPageId: added.id };
}

/**
 * Pull the next page up onto this one.
 *
 * The opposite defect to overflow, and the more common one: a continuation carrying two paragraphs,
 * or a quote given a whole page it did not ask for. Only surfaces that are not pages in themselves
 * may be absorbed, which is what stops a cover from being tidied away onto the page before it.
 */
export function absorb(plan: PrintPlan, pageId: string): PrintPlan | null {
  const index = plan.pages.findIndex((page) => page.id === pageId);
  if (index < 0 || index + 1 >= plan.pages.length) return null;
  const page = plan.pages[index];
  const next = plan.pages[index + 1];
  if (page.atomic || page.blank || next.atomic || next.blank) return null;
  if (next.surfaces.some((surface) => WHOLE_PAGE.has(surface.kind))) return null;

  const surfaces = [...page.surfaces];
  for (const surface of next.surfaces) {
    const last = surfaces[surfaces.length - 1];
    if (last && last.surfaceId === surface.surfaceId) {
      surfaces[surfaces.length - 1] = { ...last, blocks: [...last.blocks, ...surface.blocks], continues: surface.continues };
    } else {
      surfaces.push(surface);
    }
  }
  const pages = [...plan.pages.slice(0, index), { ...page, surfaces, fit: Math.max(page.fit, next.fit) }, ...plan.pages.slice(index + 2)];
  return renumber({ ...plan, pages });
}

/** One step of copyfit on one page: the last resort before a page is allowed to be wrong. */
export function tighten(plan: PrintPlan, pageId: string, by = 1): PrintPlan | null {
  const page = findPage(plan, pageId);
  if (!page || page.blank) return null;
  const fit = Math.min(FIT_STEPS.max, Math.max(FIT_STEPS.min, page.fit + by));
  if (fit === page.fit) return null;
  return { ...plan, pages: plan.pages.map((candidate) => (candidate.id === pageId ? { ...candidate, fit } : candidate)) };
}

/**
 * Drop a page that earns nothing.
 *
 * Only a page the design did not ask for: an empty continuation left behind after copy was cut, or
 * a surface whose every block resolved to nothing. Never a blank held for a recto, which is paper
 * spent on purpose.
 */
export function dropEmpty(plan: PrintPlan): PrintPlan {
  const pages = plan.pages.filter((page) => page.blank || page.surfaces.some((surface) => surface.blocks.length));
  return pages.length === plan.pages.length ? plan : renumber({ ...plan, pages });
}

/* ── Saying what happened, in words rather than in numbers ───────────────────────────────── */

export function describePlan(plan: PrintPlan): string {
  const printed = plan.pages.filter((page) => !page.blank).length;
  const blanks = plan.pages.length - printed;
  const carried = plan.pages.filter((page) => page.surfaces.some((surface) => surface.continued)).length;
  const tightened = plan.pages.filter((page) => page.fit > 0).length;
  const parts = [`${plan.pages.length} pages on ${plan.size.label}`];
  if (blanks) parts.push(`${blanks} blank so openers fall on the right`);
  if (carried) parts.push(`${carried} carrying a story on from the page before`);
  if (tightened) parts.push(`${tightened} set a little tighter to fit`);
  return parts.join(", ");
}

/** What the design asked for against what the paper allowed, for the critic and the console. */
export function planIntegrity(design: EditionDesign, plan: PrintPlan): { brokenAtomic: string[]; splitKeepTogether: string[]; missingSurfaces: string[] } {
  const seen = new Map<string, number>();
  for (const page of plan.pages) for (const surface of page.surfaces) seen.set(surface.surfaceId, (seen.get(surface.surfaceId) ?? 0) + 1);

  const brokenAtomic: string[] = [];
  const missingSurfaces: string[] = [];
  for (const section of design.sections) {
    for (const surface of section.surfaces) {
      if (!surface.blocks.length) continue;
      const count = seen.get(surface.id) ?? 0;
      if (!count) missingSurfaces.push(surface.id);
      const pageSurface = pageSurfaceOf(surface, section.id, section.name);
      const explained = plan.relaxations.some((relaxation) => relaxation.surfaceId === surface.id);
      if (count > 1 && isAtomic(pageSurface, design) && !explained) brokenAtomic.push(surface.id);
    }
  }
  // A block that may not be split appearing on two pages means the flow pass ignored a constraint.
  const pagesByBlock = new Map<string, Set<number>>();
  for (const page of plan.pages) {
    for (const surface of page.surfaces) {
      for (const block of surface.blocks) {
        const pages = pagesByBlock.get(block.id) ?? new Set<number>();
        pages.add(page.number);
        pagesByBlock.set(block.id, pages);
      }
    }
  }
  const splitKeepTogether = [...pagesByBlock.entries()].filter(([, pages]) => pages.size > 1).map(([id]) => id);
  return { brokenAtomic, splitKeepTogether, missingSurfaces };
}

/**
 * Break a story's copy over the page turn.
 *
 * The alternative — moving the whole block down — is what produces a half-empty page followed by a
 * full one, and it is why software-set publications look like software. Splitting the text is what
 * a magazine actually does, so the head keeps the paragraphs that fit and the tail becomes a
 * continuation of the same story, carrying the rest.
 *
 * Which paragraphs fit is a question for the browser, not for this function: the caller hands over
 * the two lists it measured. What this decides is whether the split is allowed at all, and what
 * the continuation is: no headline, no picture, no second byline — the story, resumed.
 */
export function splitCopy(plan: PrintPlan, pageId: string, blockId: string, keep: string[], tail: string[]): { plan: PrintPlan; tailBlockId: string } | null {
  if (!keep.length || !tail.length) return null;
  const pageIndex = plan.pages.findIndex((page) => page.id === pageId);
  if (pageIndex < 0) return null;
  const page = plan.pages[pageIndex];

  for (const [surfaceIndex, surface] of page.surfaces.entries()) {
    const blockIndex = surface.blocks.findIndex((block) => block.id === blockId);
    if (blockIndex < 0) continue;
    const block = surface.blocks[blockIndex];
    // A block that may not be broken may not be broken, however convenient it would be here.
    if (block.constraints.keepTogether) return null;
    const bodyIndex = block.elements.findIndex((element) => element.role === "body" && element.content.kind === "article");
    if (bodyIndex < 0) return null;
    const body = block.elements[bodyIndex];
    if (body.content.kind !== "article") return null;

    const head: DesignBlock = {
      ...block,
      elements: block.elements.map((element, index) => (index === bodyIndex ? { ...element, content: { ...body.content, blockIds: keep } } : element)),
      constraints: { ...block.constraints, keepWithNext: false },
    };
    const carried: DesignElement = { ...body, id: designId("el"), content: { ...body.content, blockIds: tail } };
    const tailBlock: DesignBlock = {
      ...block,
      id: designId("bl"),
      // A continuation is the story resumed, not the story restated: no headline, no second byline.
      role: "secondary",
      composition: "text-only",
      elements: [carried],
      style: { ...block.style, ruleAbove: false },
      constraints: { ...block.constraints, avoidBreakBefore: false, keepWithNext: false },
      alternatives: [],
      rationale: "the rest of the story, carried over",
    };
    const blocks = [...surface.blocks.slice(0, blockIndex), head, tailBlock, ...surface.blocks.slice(blockIndex + 1)];
    const surfaces = page.surfaces.map((candidate, index) => (index === surfaceIndex ? { ...candidate, blocks } : candidate));
    const pages = plan.pages.map((candidate, index) => (index === pageIndex ? { ...candidate, surfaces } : candidate));
    return { plan: renumber({ ...plan, pages }), tailBlockId: tailBlock.id };
  }
  return null;
}

/**
 * Move the least important thing off a page that cannot be made to fit.
 *
 * The last move before giving up, and the one the model was built for: `priority` exists so that
 * when the space runs out something specific gives way. A pull quote leaves an opener before the
 * lead does; a sponsor's mark leaves before either. It is allowed on an atomic page — a page that
 * spills off the sheet is worse than an opener missing its ornament — and it is written down,
 * because overruling the design quietly is how a design engine stops being trustworthy.
 */
export function demote(plan: PrintPlan, pageId: string, overflowing: readonly string[]): { plan: PrintPlan; blockId: string } | null {
  const index = plan.pages.findIndex((page) => page.id === pageId);
  if (index < 0) return null;
  const page = plan.pages[index];
  if (page.blank) return null;

  const candidates = page.surfaces.flatMap((surface) => surface.blocks.map((block) => ({ surface, block })));
  if (candidates.length < 2) return null;
  const wanted = candidates.filter((entry) => overflowing.includes(entry.block.id));
  const pool = wanted.length ? wanted : candidates.slice(1);
  // Lowest priority first; where two are equal the later one goes, because the page is read down.
  const chosen = pool.reduce((lowest, entry) => (entry.block.constraints.priority <= lowest.block.constraints.priority ? entry : lowest), pool[0]);

  const head = page.surfaces
    .map((surface) => (surface.surfaceId === chosen.surface.surfaceId ? { ...surface, blocks: surface.blocks.filter((block) => block.id !== chosen.block.id) } : surface))
    .filter((surface) => surface.blocks.length);
  if (!head.length) return null;

  const carried: PageSurface = { ...chosen.surface, blocks: [chosen.block], continued: true };
  const next = plan.pages[index + 1];
  const pages = [...plan.pages];
  pages[index] = { ...page, surfaces: head };
  if (next && !next.atomic && !next.blank) {
    const first = next.surfaces[0];
    const merged =
      first && first.surfaceId === carried.surfaceId
        ? [{ ...first, blocks: [...carried.blocks, ...first.blocks] }, ...next.surfaces.slice(1)]
        : [carried, ...next.surfaces];
    pages[index + 1] = { ...next, surfaces: merged };
  } else {
    pages.splice(index + 1, 0, { id: designId("pg"), number: 0, surfaces: [carried], atomic: false, fit: page.fit, side: "left", blank: false });
  }
  const relaxations = [
    ...plan.relaxations,
    { surfaceId: chosen.surface.surfaceId, blockId: chosen.block.id, fromPage: page.number, reason: `the ${chosen.block.role.replace("-", " ")} would not fit on the page` },
  ];
  return { plan: renumber({ ...plan, pages, relaxations }), blockId: chosen.block.id };
}
