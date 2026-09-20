import type { EditionDocument } from "@/lib/publication/document";
import { blocksOf, block as makeBlock, element, emptyDesign, section as makeSection, surface as makeSurface, type ContentRef, type DesignBlock, type DesignElement, type DesignSurface, type EditionDesign } from "./model";
import { COMPOSITIONS, IMPORTANCE_WEIGHT, isComposition, type BlockRole, type Importance } from "./roles";
import { measureFor, spanFor, gridForDirection } from "./grid";
import type { ResolvedDirection } from "./identity";
import type { DesignPlan, PlannedSurface } from "./plan";
import type { EditionSignals, StorySignal } from "./signals";

/**
 * The plan, composed.
 *
 * This is where "no template-first architecture" stops being a principle and becomes code. Nothing
 * here selects a page template. Each block is a *role*, and the composition it is drawn in is
 * chosen from what the block actually has — a picture or none, a portrait or a landscape, four
 * hundred words or four thousand, figures worth setting large — and from what the publication is:
 * how dense, how much colour, how much variation it tolerates before a shape starts to read as a
 * habit.
 *
 * Three properties hold this together:
 *
 *  - **A composition is never chosen for a block that cannot support it.** An image-led lead with
 *    no image is a blank half-page, so the chooser is given the material, not just the role.
 *  - **The same shape is not used twice in a row beyond the publication's tolerance.** A magazine
 *    has a recognisable system and composes every issue differently; a template library has one
 *    shape repeated until the reader stops seeing it.
 *  - **Every choice carries its reason and its alternatives.** The rationale is what the console
 *    shows and what the conversation argues with; the alternatives are what "change layout" offers,
 *    and they are real compositions rather than a list called Template 4.
 */

export type ComposeInput = {
  editionId: string;
  document: EditionDocument;
  signals: EditionSignals;
  direction: ResolvedDirection;
  plan: DesignPlan;
};

type Context = {
  story: StorySignal | null;
  importance: Importance;
  direction: ResolvedDirection;
  /** Compositions used recently, newest first, for the rhythm guard. */
  recent: string[];
  /** How full this surface is meant to feel. */
  density: number;
};

/* ── Choosing a composition ───────────────────────────────────────────────────────────────── */

/**
 * The compositions this block could legitimately be drawn in, best first.
 *
 * Returning a ranked list rather than one answer is deliberate: the rhythm guard needs somewhere to
 * go when its first choice has just been used, and "change layout" needs real alternatives. A
 * composition the material cannot support never appears in the list at all.
 */
export function candidatesFor(role: BlockRole, ctx: Context): string[] {
  const all = COMPOSITIONS[role];
  const pictures = ctx.story?.usablePictures ?? 0;
  const portrait = ctx.story?.hasPortrait ?? false;
  const words = ctx.story?.words ?? 0;
  const figures = ctx.story?.figures ?? 0;
  const { genome, imagery } = ctx.direction;
  const weight = IMPORTANCE_WEIGHT[ctx.importance];

  const rank = (composition: string): number | null => {
    // A composition that needs a picture is not an option without one. This is the rule that stops
    // an "image-led" anything from being a blank space with a caption under it.
    const needsPicture = /image|photo|portrait|full-bleed|collage/.test(composition);
    if (needsPicture && pictures === 0) return null;
    if (composition.includes("portrait") && !portrait) return null;
    if (composition === "full-spread" && pictures < 1) return null;
    if (composition === "lead-and-three" && pictures < 4) return null;
    if (composition === "three-up" && pictures < 3 && role !== "brief-group") return null;
    if (composition === "two-by-two" && pictures < 4) return null;
    if (composition === "data-led" && figures < 3) return null;

    let score = 0.5;
    // Pictures pull toward picture-led compositions, in proportion to how much this publication
    // wants photography to lead.
    if (needsPicture) score += imagery.emphasis * 0.5 + Math.min(0.3, pictures * 0.1);
    else score += (1 - imagery.emphasis) * 0.2;
    // Importance buys space: a full bleed or a split belongs to something that matters.
    if (/full|split|large|editorial-split|oversized/.test(composition)) score += weight * 0.4 - 0.1;
    // Density decides how much fits: three columns and grids for dense publications, air for others.
    if (/three-column|grid|two-by-two|three-up|stack/.test(composition)) score += genome.density * 0.35;
    if (/minimal|text-only|plain|one-line/.test(composition)) score += genome.minimalism * 0.35;
    // Long pieces want columns; short ones do not.
    if (composition.includes("three-column")) score += words > 900 ? 0.25 : -0.3;
    if (composition.includes("two-column")) score += words > 400 ? 0.15 : -0.1;
    if (composition === "text-only") score += pictures === 0 ? 0.6 : -0.4;
    // An expressive voice reaches for the compositions that are about type.
    if (/headline|typographic|oversized/.test(composition)) score += genome.typographicVoice === "expressive" ? 0.3 : genome.typographicVoice === "quiet" ? -0.15 : 0.05;
    if (/sidebar/.test(composition)) score += figures >= 2 ? 0.25 : -0.2;
    return score;
  };

  return all
    .map((composition) => ({ composition, score: rank(composition) }))
    .filter((entry): entry is { composition: string; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.composition);
}

/**
 * The composition, with the rhythm guard applied.
 *
 * The guard is the difference between a publication and a template: a shape used more often than
 * this publication tolerates gives way to the next best one, unless there is no next best — in
 * which case repeating is still better than drawing something the material cannot support.
 */
export function chooseComposition(role: BlockRole, ctx: Context): { composition: string; alternatives: string[]; rationale: string } {
  const candidates = candidatesFor(role, ctx);
  if (candidates.length === 0) {
    const fallback = COMPOSITIONS[role][0];
    return { composition: fallback, alternatives: [], rationale: "nothing else this block can be drawn as" };
  }
  const limit = ctx.direction.rhythm.repeatLimit;
  const recentlyUsed = ctx.recent.slice(0, limit);
  const fresh = candidates.find((candidate) => !recentlyUsed.includes(candidate));
  const composition = fresh ?? candidates[0];
  const alternatives = candidates.filter((candidate) => candidate !== composition).slice(0, 3);
  return { composition, alternatives, rationale: reasonFor(role, composition, ctx, composition !== candidates[0]) };
}

function reasonFor(role: BlockRole, composition: string, ctx: Context, displaced: boolean): string {
  const pictures = ctx.story?.usablePictures ?? 0;
  const parts: string[] = [];
  if (/image|photo|portrait|full-bleed/.test(composition)) parts.push(pictures > 1 ? `${pictures} pictures to place` : "it has a picture worth the space");
  else if (pictures === 0) parts.push("no picture, so the words carry it");
  if (ctx.importance === "COVER" || ctx.importance === "LEAD") parts.push("it is what the issue leads on");
  if (ctx.importance === "BRIEF") parts.push("it is short");
  if (displaced) parts.push("the obvious shape had just been used");
  return parts.join("; ") || `a ${role.replace("-", " ")} of ordinary weight`;
}

/* ── Building elements ────────────────────────────────────────────────────────────────────── */

function articleRef(articleId: string, part: "headline" | "kicker" | "standfirst" | "byline" | "body" | "excerpt" | "pullquote"): ContentRef {
  return { kind: "article", articleId, part };
}

/**
 * Headlines get fewer lines the more they matter.
 *
 * A lead headline over four lines is not a lead headline; it is a paragraph in a large size. The
 * constraint is what the typography engine composes against, and it is stated here because it is
 * an editorial decision rather than a measurement.
 */
function headlineLines(importance: Importance): number {
  switch (importance) {
    case "COVER":
      return 2;
    case "LEAD":
      return 3;
    case "MAJOR":
      return 3;
    case "BRIEF":
    case "SUPPORTING":
      return 2;
    default:
      return 4;
  }
}

function typeRoleFor(importance: Importance): DesignElement["style"]["type"] {
  switch (importance) {
    case "COVER":
      return "display-xl";
    case "LEAD":
      return "display-l";
    case "MAJOR":
      return "headline";
    case "STANDARD":
      return "subheadline";
    default:
      return "body";
  }
}

function storyElements(role: BlockRole, ctx: Context, composition: string, measure: { min: number; max: number }): DesignElement[] {
  const story = ctx.story;
  if (!story) return [];
  const importance = ctx.importance;
  const weight = IMPORTANCE_WEIGHT[importance];
  const elements: DesignElement[] = [];
  const picture = story.bestPictureId;
  const showsPicture = picture && /image|photo|portrait|full-bleed|opener|split|collage|compact|side/.test(composition);

  // A picture first when the composition leads with one: the order here is reading order, which is
  // what every renderer falls back to when it has nothing better.
  if (showsPicture && /full-bleed|opener|image-first|compact-image-top|image-led/.test(composition)) {
    elements.push(pictureElement(picture, weight, composition));
  }

  if (importance !== "BRIEF" && ctx.direction.ornament > 0.25) {
    elements.push(element("kicker", articleRef(story.articleId, "kicker"), { style: { type: "label" }, constraints: { priority: 0.2 } }));
  }
  elements.push(
    element("headline", articleRef(story.articleId, "headline"), {
      style: { type: typeRoleFor(importance), emphasis: weight },
      constraints: { priority: Math.max(0.8, weight), maxHeadlineLines: headlineLines(importance), keepWithNext: true },
    }),
  );
  if (importance === "COVER" || importance === "LEAD" || importance === "MAJOR") {
    elements.push(element("deck", articleRef(story.articleId, "standfirst"), { style: { type: "deck" }, constraints: { priority: 0.5, ...measure } }));
  }
  if (showsPicture && !/full-bleed|opener|image-first|compact-image-top|image-led/.test(composition)) {
    elements.push(pictureElement(picture, weight, composition));
  }
  if (importance !== "BRIEF") {
    elements.push(element("byline", articleRef(story.articleId, "byline"), { style: { type: "metadata" }, constraints: { priority: 0.15 } }));
  }
  elements.push(
    element(importance === "BRIEF" ? "excerpt" : "body", articleRef(story.articleId, importance === "BRIEF" ? "excerpt" : "body"), {
      style: { type: importance === "BRIEF" ? "body-small" : "body" },
      constraints: { priority: 0.7, minMeasure: measure.min, maxMeasure: measure.max, maxWords: importance === "BRIEF" ? 60 : undefined },
    }),
  );
  return elements;
}

/**
 * Which elements a block carries, which depends on what the block *is*.
 *
 * A block attached to a story is not necessarily the story. A pull quote belongs to a story and
 * carries one sentence; a stat belongs to a story and carries a number; a photo spread belongs to a
 * story and carries photographs. Building every story-attached block as a story was how a quote
 * meant to punctuate a page ended up repeating the whole article underneath it.
 */
function elementsFor(role: BlockRole, ctx: Context, composition: string, measure: { min: number; max: number }, articleId: string | null, sectionId: string | null): DesignElement[] {
  const story = ctx.story;
  if (!story || !articleId) return furnitureElements(role, articleId, sectionId);

  switch (role) {
    case "quote":
    case "pull-quote":
      return [
        element("quote", articleRef(articleId, "pullquote"), { style: { type: role === "quote" ? "display-l" : "deck" }, constraints: { priority: 0.6, keepTogether: true, maxMeasure: 40 } }),
        element("attribution", articleRef(articleId, "byline"), { style: { type: "metadata" }, constraints: { priority: 0.2 } }),
      ];

    case "stat":
    case "stat-group":
      return [
        element("stat-value", articleRef(articleId, "excerpt"), { style: { type: "display-l" }, constraints: { priority: 0.6, keepTogether: true } }),
        element("stat-label", articleRef(articleId, "headline"), { style: { type: "label" }, constraints: { priority: 0.4 } }),
      ];

    case "photo":
    case "photo-pair":
    case "photo-grid":
    case "photo-spread":
    case "portrait": {
      if (!story.bestPictureId) return [];
      return [
        pictureElement(story.bestPictureId, 0.8, composition),
        element("caption", articleRef(articleId, "headline"), { style: { type: "caption" }, constraints: { priority: 0.2 } }),
      ];
    }

    case "cover": {
      const elements: DesignElement[] = [];
      if (story.bestPictureId && /image|photo|portrait|collage/.test(composition)) elements.push(pictureElement(story.bestPictureId, 1, composition));
      // The story's own kicker, never the issue label: the masthead directly above it is already
      // printing that, and a cover that says "Special issue N°1" twice reads as a mistake.
      elements.push(element("kicker", articleRef(articleId, "kicker"), { style: { type: "label" }, constraints: { priority: 0.3 } }));
      elements.push(element("headline", articleRef(articleId, "headline"), { style: { type: "display-xl", emphasis: 1 }, constraints: { priority: 1, maxHeadlineLines: 2, keepWithNext: true } }));
      elements.push(element("deck", articleRef(articleId, "standfirst"), { style: { type: "deck" }, constraints: { priority: 0.5, ...measure } }));
      return elements;
    }

    default:
      return storyElements(role, ctx, composition, measure);
  }
}

function pictureElement(mediaId: string, weight: number, composition: string): DesignElement {
  const bleeds = /full-bleed|full-spread|image-led/.test(composition);
  return element(
    "image",
    { kind: "media", mediaId },
    {
      constraints: { priority: Math.max(0.5, weight), fullBleed: bleeds, aspect: bleeds ? null : undefined },
      style: { emphasis: weight },
    },
  );
}

/* ── Composing ────────────────────────────────────────────────────────────────────────────── */

export function composeDesign(input: ComposeInput): EditionDesign {
  const { editionId, signals, direction, plan } = input;
  const grid = gridForDirection(direction);
  const byArticle = new Map(signals.stories.map((story) => [story.articleId, story]));
  const design = emptyDesign(editionId, grid);
  const recent: string[] = [];

  // Surfaces are grouped into design sections by the editorial section they belong to, so a
  // renderer can treat a section as a run rather than re-deriving it from ids.
  const sections = new Map<string, { name: string; surfaces: DesignSurface[] }>();
  const sectionName = new Map(signals.sections.map((section) => [section.id, section.name]));

  for (const planned of plan.surfaces) {
    const surface = composeSurface(planned, { byArticle, direction, recent, signals });
    const key = planned.sectionId ?? "—";
    const group = sections.get(key) ?? { name: planned.sectionId ? (sectionName.get(planned.sectionId) ?? "Section") : frontOrBack(planned), surfaces: [] };
    group.surfaces.push(surface);
    sections.set(key, group);
  }

  const built = {
    ...design,
    grid,
    sections: [...sections.entries()].map(([key, group]) => makeSection(group.name, { sectionId: key === "—" ? null : key, surfaces: group.surfaces })),
  };
  return built;
}

function frontOrBack(planned: PlannedSurface): string {
  return planned.kind === "cover" ? "Front" : planned.kind === "close" ? "Back" : "The issue";
}

function composeSurface(
  planned: PlannedSurface,
  env: { byArticle: Map<string, StorySignal>; direction: ResolvedDirection; recent: string[]; signals: EditionSignals },
): DesignSurface {
  const blocks: DesignBlock[] = [];
  for (const intended of planned.blocks) {
    const role = intended.role as BlockRole;
    const story = intended.articleId ? (env.byArticle.get(intended.articleId) ?? null) : null;
    const ctx: Context = { story, importance: intended.importance, direction: env.direction, recent: env.recent, density: planned.density };
    const chosen = chooseComposition(role, ctx);
    env.recent.unshift(chosen.composition);
    env.recent.length = Math.min(env.recent.length, 8);

    const grid = gridForDirection(env.direction);
    const span = spanFor(role, intended.importance, grid, { fullBleed: chosen.composition.includes("full-bleed"), hasPicture: (story?.usablePictures ?? 0) > 0 });
    const measure = measureFor(span, grid, env.direction);

    blocks.push(
      makeBlock(role, {
        composition: chosen.composition,
        importance: intended.importance,
        storyId: story?.storyId ?? null,
        articleId: intended.articleId,
        elements: elementsFor(role, ctx, chosen.composition, measure, intended.articleId, planned.sectionId),
        constraints: {
          priority: IMPORTANCE_WEIGHT[intended.importance],
          minWidth: Math.round((span.span / grid.columns) * 100) / 100,
          maxWidth: Math.round((span.span / grid.columns) * 100) / 100,
          keepTogether: role === "quote" || role === "stat" || role === "pull-quote" || intended.importance === "BRIEF",
          fullBleed: chosen.composition.includes("full-bleed") || chosen.composition === "full-spread",
        },
        style: { emphasis: IMPORTANCE_WEIGHT[intended.importance] },
        alternatives: chosen.alternatives,
        rationale: chosen.rationale,
      }),
    );
  }

  return makeSurface({
    kind: planned.kind,
    blocks,
    intent: planned.intent,
    // A cover, a section opener and a close are one surface each; a run of stories may break.
    atomic: planned.kind === "cover" || planned.kind === "opener" || planned.kind === "close",
  });
}

/**
 * The pieces that are not a story: the masthead, a section's own title, the events, the credits.
 *
 * They read from the edition's metadata rather than from an article, which is why they are built
 * separately — and why a design can carry a masthead without a story attached to it.
 */
function furnitureElements(role: BlockRole, articleId: string | null, sectionId: string | null): DesignElement[] {
  switch (role) {
    case "masthead":
      return [
        element("logo", { kind: "meta", part: "masthead" }, { style: { type: "display-l" }, constraints: { priority: 0.9 } }),
        element("label", { kind: "meta", part: "issueLabel" }, { style: { type: "label" }, constraints: { priority: 0.3 } }),
        element("dateline", { kind: "meta", part: "date" }, { style: { type: "metadata" }, constraints: { priority: 0.2 } }),
      ];
    case "section-opener":
      // The section's own name, read from the edition. An opener built from a literal would be an
      // opener that says nothing, which is what it did until a rendered page showed the empty tag.
      return sectionId ? [element("headline", { kind: "section", sectionId, part: "name" }, { style: { type: "display-l" }, constraints: { priority: 0.6 } })] : [];
    case "brief-group":
      return [element("label", { kind: "text", text: "In brief" }, { style: { type: "label" }, constraints: { priority: 0.3 } })];
    case "events":
      return [element("label", { kind: "text", text: "What is coming" }, { style: { type: "label" }, constraints: { priority: 0.3 } })];
    case "credits":
      return [element("body", { kind: "meta", part: "credits" }, { style: { type: "metadata" }, constraints: { priority: 0.1 } })];
    case "footer":
      return [
        element("link", { kind: "meta", part: "website" }, { style: { type: "metadata" }, constraints: { priority: 0.1 } }),
        element("page-number", { kind: "meta", part: "page" }, { style: { type: "metadata" }, constraints: { priority: 0.05 }, omitIn: ["email", "web"] }),
      ];
    case "stat-group":
      return articleId ? [element("stat-value", { kind: "article", articleId, part: "excerpt" }, { style: { type: "display-l" }, constraints: { priority: 0.6 } })] : [];
    default:
      return [];
  }
}

/** How many different shapes this design actually used — the number that says whether it composed or repeated. */
export function compositionSpread(design: EditionDesign): { used: number; blocks: number; repeated: string[] } {
  const compositions = blocksOf(design).map((block) => `${block.role}:${block.composition}`);
  const counts = new Map<string, number>();
  for (const key of compositions) counts.set(key, (counts.get(key) ?? 0) + 1);
  return {
    used: counts.size,
    blocks: compositions.length,
    repeated: [...counts.entries()].filter(([, n]) => n > 3).map(([key]) => key),
  };
}

/** Whether a design would draw a composition its material cannot support. */
export function unsupportedCompositions(design: EditionDesign, signals: EditionSignals): { blockId: string; composition: string; why: string }[] {
  const byArticle = new Map(signals.stories.map((story) => [story.articleId, story]));
  const problems: { blockId: string; composition: string; why: string }[] = [];
  for (const block of blocksOf(design)) {
    if (!isComposition(block.role, block.composition)) {
      problems.push({ blockId: block.id, composition: block.composition, why: "no renderer draws this" });
      continue;
    }
    const story = block.articleId ? byArticle.get(block.articleId) : null;
    const needsPicture = /image|photo|portrait|full-bleed|collage/.test(block.composition);
    if (needsPicture && story && story.usablePictures === 0) {
      problems.push({ blockId: block.id, composition: block.composition, why: "it needs a picture and the story has none" });
    }
  }
  return problems;
}
