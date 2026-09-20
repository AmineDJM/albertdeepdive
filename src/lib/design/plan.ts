import { z } from "zod";
import type { ResolvedDirection } from "./identity";
import type { EditionSignals, StorySignal } from "./signals";
import { assignImportance } from "./signals";
import { IMPORTANCE, type BlockRole, type Importance } from "./roles";

/**
 * What this edition will be, surface by surface, before anything is composed.
 *
 * §79 of the design brief asks for a plan first: cover portrait-led, opening a large lead beside a
 * short editor's note, the middle denser, a visual reset on page seven, a data spread, events and a
 * compact close. Then render. The order matters — a composer working story by story produces a
 * correct edition with no rhythm, which is exactly the stack of identical blocks §6 warns about.
 *
 * A plan is intent, not layout. It names what each surface is *for* and what belongs on it; the
 * composer chooses the compositions and the renderers decide what any of it means on a page, in a
 * browser and in an inbox.
 */

export const plannedSurfaceSchema = z.object({
  id: z.string(),
  kind: z.enum(["cover", "opener", "spread", "flow", "close"]),
  /** What this surface is for, in the plan's own words. Shown to the editor, read by the critic. */
  intent: z.string().max(200),
  /** The blocks intended here, in order. The composer may refine, not reinvent. */
  blocks: z.array(
    z.object({
      role: z.string(),
      articleId: z.string().nullable().default(null),
      importance: z.enum(IMPORTANCE).default("STANDARD"),
      /** Why this is here rather than somewhere else. */
      note: z.string().max(200).optional(),
    }),
  ),
  /** 0–1. How full this surface should feel — the lever that makes rhythm real. */
  density: z.number().min(0).max(1).default(0.5),
  sectionId: z.string().nullable().default(null),
});
export type PlannedSurface = z.infer<typeof plannedSurfaceSchema>;

export const designPlanSchema = z.object({
  editionId: z.string(),
  /** The sentence the whole plan follows from. */
  narrative: z.string().max(400),
  surfaces: z.array(plannedSurfaceSchema),
  /** What the director decided and why, for the console and the conversation. */
  decisions: z.array(z.object({ decision: z.string().max(200), because: z.string().max(200) })).default([]),
  source: z.enum(["model", "local"]).default("local"),
});
export type DesignPlan = z.infer<typeof designPlanSchema>;

let counter = 0;
function surfaceId(prefix: string): string {
  counter += 1;
  return `${prefix}${counter}`;
}

type PlanBlock = PlannedSurface["blocks"][number];

/**
 * A plan built from the material, with no model involved.
 *
 * This is not a fallback in the apologetic sense. It is the floor: an edition composed from these
 * rules alone must still read as edited — a cover, a lead with room, sections that open, a rhythm
 * that varies, briefs gathered rather than strung out, a close. A model's contribution is judgement
 * on top of that, and if the model is unavailable, badly configured or wrong, what remains is a
 * publication rather than a list.
 *
 * Deterministic: same signals and same direction, same plan.
 */
export function planEdition(editionId: string, signals: EditionSignals, direction: ResolvedDirection, overrides?: ReadonlyMap<string, Importance>): DesignPlan {
  /*
   * The ranking, with the director's judgement over the top.
   *
   * The arithmetic knows a story is short and has no picture. It cannot know that the short piece
   * with no picture announces a merger, and that the issue is about that. A model can, and this is
   * the one thing it is asked for — what matters — because everything else about the plan is better
   * decided by rules that behave the same way every time.
   */
  const importance = new Map(assignImportance(signals));
  if (overrides) for (const [articleId, value] of overrides) if (importance.has(articleId)) importance.set(articleId, value);
  const decisions: { decision: string; because: string }[] = [];
  const surfaces: PlannedSurface[] = [];
  const byImportance = (story: StorySignal): Importance => importance.get(story.articleId) ?? "STANDARD";

  // ── The cover ─────────────────────────────────────────────────────────────────────────────
  const lead = signals.dominant ?? signals.stories[0] ?? null;
  const coverApproach = pickCover(signals, direction);
  if (lead) {
    surfaces.push(
      plannedSurfaceSchema.parse({
        id: surfaceId("s"),
        kind: "cover",
        intent: `Cover: ${coverApproach.replace("-", " ")}`,
        density: 0.2,
        blocks: [
          { role: "masthead" as BlockRole, articleId: null, importance: "SUPPORTING" as Importance },
          { role: "cover" as BlockRole, articleId: lead.articleId, importance: "COVER" as Importance, note: lead.because },
        ],
      }),
    );
    decisions.push({ decision: `A ${coverApproach} cover`, because: coverReason(coverApproach, signals) });
  }

  // ── The opening ───────────────────────────────────────────────────────────────────────────
  // The lead gets a surface of its own with room around it. This is the single clearest signal a
  // reader gets that somebody decided what mattered.
  if (lead) {
    const blocks: PlanBlock[] = [{ role: "lead", articleId: lead.articleId, importance: byImportance(lead), note: "the issue's lead" }];
    if (lead.quotes > 0 && direction.genome.minimalism < 0.8) blocks.push({ role: "pull-quote", articleId: lead.articleId, importance: "SUPPORTING", note: "a line worth setting large" });
    surfaces.push(plannedSurfaceSchema.parse({ id: surfaceId("s"), kind: "opener", intent: "The lead, with room around it", density: Math.min(0.45, direction.genome.density), blocks, sectionId: lead.sectionId }));
  }

  // ── The middle, section by section ────────────────────────────────────────────────────────
  const placed = new Set<string>(lead ? [lead.articleId] : []);
  const sectionsInOrder = signals.sections.filter((section) => signals.stories.some((s) => s.sectionId === section.id && !placed.has(s.articleId)));

  for (const section of sectionsInOrder) {
    const own = signals.stories.filter((s) => s.sectionId === section.id && !placed.has(s.articleId));
    if (own.length === 0) continue;

    // A section opens when there is enough behind it to be worth announcing, and when the
    // publication is not so minimal that an opener would be the loudest thing in it.
    if (own.length >= 2 && direction.ornament > 0.15) {
      surfaces.push(
        plannedSurfaceSchema.parse({
          id: surfaceId("s"),
          kind: "opener",
          intent: `${section.name} opens`,
          density: 0.15,
          sectionId: section.id,
          blocks: [{ role: "section-opener", articleId: null, importance: "SUPPORTING", note: `${own.length} pieces follow` }],
        }),
      );
    }

    const majors = own.filter((s) => byImportance(s) === "LEAD" || byImportance(s) === "MAJOR");
    const ordinary = own.filter((s) => byImportance(s) === "STANDARD");
    const briefs = own.filter((s) => byImportance(s) === "BRIEF" || byImportance(s) === "SUPPORTING");

    for (const story of majors) {
      placed.add(story.articleId);
      const blocks: PlanBlock[] = [{ role: "feature", articleId: story.articleId, importance: byImportance(story), note: story.because }];
      if (story.figures >= 3) blocks.push({ role: "stat-group", articleId: story.articleId, importance: "SUPPORTING", note: "its figures, set as figures" });
      surfaces.push(plannedSurfaceSchema.parse({ id: surfaceId("s"), kind: "flow", intent: `${section.name}: a major piece`, density: densityFor(direction, 0.55), blocks, sectionId: section.id }));
    }

    // Ordinary pieces share surfaces; how many depends on how dense this publication is.
    const perSurface = Math.max(1, Math.round(1 + direction.genome.density * 2));
    for (let i = 0; i < ordinary.length; i += perSurface) {
      const group = ordinary.slice(i, i + perSurface);
      for (const story of group) placed.add(story.articleId);
      surfaces.push(
        plannedSurfaceSchema.parse({
          id: surfaceId("s"),
          kind: "flow",
          intent: group.length === 1 ? `${section.name}: a piece` : `${section.name}: ${group.length} pieces together`,
          density: densityFor(direction, 0.6),
          sectionId: section.id,
          blocks: group.map((story) => ({ role: "secondary" as BlockRole, articleId: story.articleId, importance: byImportance(story), note: story.because })),
        }),
      );
    }

    // Briefs are gathered, never strung out one to a surface: a page of six short items is a
    // deliberate shape, and six surfaces each holding one short item is an accident.
    if (briefs.length) {
      for (const story of briefs) placed.add(story.articleId);
      surfaces.push(
        plannedSurfaceSchema.parse({
          id: surfaceId("s"),
          kind: "flow",
          intent: `${section.name}: the short pieces, gathered`,
          density: Math.min(0.85, densityFor(direction, 0.7)),
          sectionId: section.id,
          blocks: [{ role: "brief-group", articleId: null, importance: "BRIEF", note: `${briefs.length} short items` }, ...briefs.map((story) => ({ role: "brief" as BlockRole, articleId: story.articleId, importance: "BRIEF" as Importance }))],
        }),
      );
      decisions.push({ decision: `${briefs.length} short pieces gathered rather than strung out`, because: "a page of shorts is a shape; one short per page is an accident" });
    }
  }

  // Anything in no section at all still belongs somewhere.
  const orphans = signals.stories.filter((s) => !placed.has(s.articleId));
  if (orphans.length) {
    for (const story of orphans) placed.add(story.articleId);
    surfaces.push(
      plannedSurfaceSchema.parse({
        id: surfaceId("s"),
        kind: "flow",
        intent: "The rest of the issue",
        density: densityFor(direction, 0.6),
        blocks: orphans.map((story) => ({ role: (byImportance(story) === "BRIEF" ? "brief" : "secondary") as BlockRole, articleId: story.articleId, importance: byImportance(story) })),
      }),
    );
  }

  // ── The resets ────────────────────────────────────────────────────────────────────────────
  // A long run of similar surfaces is what makes an edition feel like a list. Where the material
  // allows it, something different is put in the middle: a quote, a photograph, a page of figures.
  insertResets(surfaces, signals, direction, decisions);

  // ── The close ─────────────────────────────────────────────────────────────────────────────
  const closing: PlanBlock[] = [];
  if (signals.counts.events > 0) closing.push({ role: "events", articleId: null, importance: "SUPPORTING", note: `${signals.counts.events} things coming up` });
  closing.push({ role: "credits", articleId: null, importance: "SUPPORTING" });
  closing.push({ role: "footer", articleId: null, importance: "SUPPORTING" });
  surfaces.push(plannedSurfaceSchema.parse({ id: surfaceId("s"), kind: "close", intent: "What is coming, who made it", density: 0.35, blocks: closing }));

  return designPlanSchema.parse({
    editionId,
    narrative: "",
    surfaces,
    decisions,
    source: "local",
  });
}

function densityFor(direction: ResolvedDirection, base: number): number {
  // The publication's own density pulls every surface toward it, without flattening the variation
  // the plan is trying to create.
  return Math.round(Math.min(1, Math.max(0.1, base * 0.5 + direction.genome.density * 0.7)) * 100) / 100;
}

function pickCover(signals: EditionSignals, direction: ResolvedDirection): ResolvedDirection["cover"] {
  // The direction's preference, unless the material cannot support it. A photographic cover with no
  // photograph is not a preference, it is a blank page.
  const preferred = direction.cover;
  const lead = signals.dominant ?? signals.stories[0] ?? null;
  const hasPicture = Boolean(lead?.bestPictureId);
  if ((preferred === "image-led" || preferred === "collage") && !hasPicture) return signals.dataDensity > 0.5 ? "data-led" : "typographic";
  if (preferred === "portrait-led" && !lead?.hasPortrait) return hasPicture ? "image-led" : "typographic";
  if (preferred === "data-led" && signals.dataDensity < 0.25) return hasPicture ? "image-led" : "typographic";
  return preferred;
}

function coverReason(approach: string, signals: EditionSignals): string {
  switch (approach) {
    case "image-led":
      return "the lead story has a picture worth the front";
    case "portrait-led":
      return "the lead is about a person";
    case "data-led":
      return "the issue's strongest material is quantitative";
    case "typographic":
      return signals.counts.usablePictures === 0 ? "there is no usable photography, so the words carry it" : "the headline is stronger than the photograph";
    case "minimal":
      return "the publication holds itself back";
    default:
      return "it suits the material";
  }
}

/**
 * Break a run of similar surfaces with something that is not another story.
 *
 * The rule the brief states as "dense → spacious → image-led → text-led → quote → data". Applied
 * only where the material allows: a reset invented out of nothing is decoration, and decoration is
 * what an edition looks like when it has nothing to say.
 */
function insertResets(surfaces: PlannedSurface[], signals: EditionSignals, direction: ResolvedDirection, decisions: { decision: string; because: string }[]) {
  const limit = direction.rhythm.repeatLimit;
  const quotable = signals.stories.filter((s) => s.quotes > 0).sort((a, b) => b.quotes - a.quotes);
  const photographic = signals.stories.filter((s) => s.usablePictures >= 2).sort((a, b) => b.usablePictures - a.usablePictures);
  const numeric = signals.stories.filter((s) => s.figures >= 3).sort((a, b) => b.figures - a.figures);

  let run = 0;
  const used = { quote: 0, photo: 0, data: 0 };
  for (let i = 1; i < surfaces.length; i += 1) {
    const previous = surfaces[i - 1];
    const current = surfaces[i];
    const same = previous.kind === current.kind && Math.abs(previous.density - current.density) < 0.12;
    run = same ? run + 1 : 0;
    if (run < limit) continue;

    // Whichever kind of reset this edition can actually afford, least used first.
    const quote = quotable[used.quote];
    const photo = photographic[used.photo];
    const data = numeric[used.data];
    let reset: PlannedSurface | null = null;
    if (photo && direction.imagery.emphasis >= 0.5) {
      used.photo += 1;
      reset = plannedSurfaceSchema.parse({ id: surfaceId("r"), kind: "flow", intent: "A visual reset", density: 0.2, sectionId: photo.sectionId, blocks: [{ role: "photo-spread", articleId: photo.articleId, importance: "SUPPORTING", note: "pictures given the whole surface" }] });
    } else if (quote) {
      used.quote += 1;
      reset = plannedSurfaceSchema.parse({ id: surfaceId("r"), kind: "flow", intent: "A quote, as punctuation", density: 0.15, sectionId: quote.sectionId, blocks: [{ role: "quote", articleId: quote.articleId, importance: "SUPPORTING", note: "the strongest line in the section" }] });
    } else if (data) {
      used.data += 1;
      reset = plannedSurfaceSchema.parse({ id: surfaceId("r"), kind: "flow", intent: "The figures, together", density: 0.4, sectionId: data.sectionId, blocks: [{ role: "stat-group", articleId: data.articleId, importance: "SUPPORTING", note: "numbers worth setting large" }] });
    }
    if (!reset) continue;

    surfaces.splice(i, 0, reset);
    decisions.push({ decision: `A reset after ${run + 1} similar surfaces`, because: "an edition that repeats itself reads as a list" });
    run = 0;
    i += 1;
  }
}

/** The plan in a paragraph, for the editor and for the critic that will judge the result. */
export function describePlan(plan: DesignPlan): string {
  const lines = plan.surfaces.map((surface, index) => `${index + 1}. ${surface.intent}`);
  return [plan.narrative, ...lines].filter(Boolean).join("\n");
}
