import { z } from "zod";
import { runService, type AiServiceContext } from "./common";
import { DESIGN_MOODS } from "@/lib/design/genome";
import { IMPORTANCE, type Importance } from "@/lib/design/roles";
import { describeEdition, type EditionSignals } from "@/lib/design/signals";
import type { ResolvedDirection } from "@/lib/design/identity";

/**
 * The design director, at edition scale.
 *
 * It answers two questions and no others: *what is this issue about*, and *what does that mean for
 * how it should feel*. It does not lay anything out. It cannot name a colour, a typeface, a size, a
 * position or a page, because the schema it must answer in has no words for them — the same
 * boundary that keeps the Creative Studio's output from looking generated.
 *
 * What it adds over the arithmetic is the one thing arithmetic cannot do: judgement about
 * importance. A four-hundred-word piece with no photograph can be the most important thing in the
 * issue, and only something that has read it knows that. Everything else — the rhythm, the resets,
 * how many briefs share a surface, when a section opens — is decided by rules, because rules behave
 * the same way every time and a design that changes for no reason is a design nobody trusts.
 */

export const designDirectionSchema = z.object({
  /**
   * One or two sentences: what this issue is, and what that means for the design.
   *
   * Shown to the editor as the reason their edition looks as it does, so it is written in their
   * language and not in the design system's.
   */
  narrative: z.string().min(10).max(400),
  /** The mood this issue should be composed in, or null to keep the title's own. */
  mood: z.enum(DESIGN_MOODS).nullable(),
  /** The cover approach, chosen from the material rather than from habit. */
  cover: z.enum(["image-led", "typographic", "portrait-led", "data-led", "minimal", "collage"]).nullable(),
  /**
   * Departures from the title's usual dials, each 0–1, and only where this issue genuinely differs.
   *
   * A director that moves every dial on every issue has destroyed the publication's identity, which
   * is why these are optional and why the prompt asks for restraint.
   */
  dials: z
    .object({
      density: z.number().min(0).max(1).nullable(),
      colourIntensity: z.number().min(0).max(1).nullable(),
      imageUsage: z.enum(["sparse", "balanced", "led"]).nullable(),
      typographicVoice: z.enum(["quiet", "confident", "expressive"]).nullable(),
      variation: z.number().min(0).max(1).nullable(),
    })
    .nullable(),
  /**
   * Stories whose importance the reading got wrong, with the reason.
   *
   * Only where editorial judgement disagrees with the arithmetic: a list that restates the ranking
   * is noise, and the prompt says so.
   */
  emphasis: z
    .array(z.object({ articleId: z.string(), importance: z.enum(IMPORTANCE), because: z.string().max(200) }))
    .max(8),
});
export type DesignDirection = z.infer<typeof designDirectionSchema>;

export type DirectEditionInput = {
  organizationName: string;
  publicationName: string;
  editionLabel: string;
  signals: EditionSignals;
  direction: ResolvedDirection;
  /** What the editor said, when they said anything. */
  steer?: string | null;
};

function describeStories(signals: EditionSignals): string {
  return signals.stories
    .slice(0, 30)
    .map((story) => {
      const facts = [
        `${story.words} words`,
        story.usablePictures ? `${story.usablePictures} usable picture${story.usablePictures === 1 ? "" : "s"}` : "no usable picture",
        story.hasPortrait ? "a portrait" : null,
        story.quotes ? `${story.quotes} quote${story.quotes === 1 ? "" : "s"}` : null,
        story.figures ? `${story.figures} figures` : null,
        story.hasEvent ? "an event" : null,
        story.isCover ? "the pipeline's cover choice" : null,
      ].filter(Boolean);
      return `— ${story.articleId}: “${story.headline}” (${facts.join(", ")})`;
    })
    .join("\n");
}

export async function directEdition(input: DirectEditionInput, ctx: AiServiceContext = {}) {
  const { signals, direction } = input;
  return runService({
    service: "design_director",
    schemaName: "design_direction",
    schema: designDirectionSchema,
    tier: "STRONG",
    maxOutputTokens: 1200,
    input: {
      organizationName: input.organizationName,
      publicationName: input.publicationName,
      editionLabel: input.editionLabel,
      reading: describeEdition(signals),
      stories: describeStories(signals),
      sections: signals.sections.map((s) => `${s.name} (${s.stories})`).join(", ") || "none",
      pictures: `${signals.counts.usablePictures} usable of ${signals.counts.pictures}`,
      picturesPerStory: signals.picturesPerStory,
      dataDensity: signals.dataDensity,
      peopleDensity: signals.peopleDensity,
      currentMood: direction.mood,
      currentDensity: direction.genome.density,
      currentColour: direction.genome.colourIntensity,
      currentImages: direction.genome.imageUsage,
      currentVoice: direction.genome.typographicVoice,
      usualCover: direction.cover,
      moods: DESIGN_MOODS.join(", "),
      importances: IMPORTANCE.join(", "),
      steer: input.steer?.trim() || "—",
    },
    ctx,
  });
}

/**
 * The director's answer, applied to what the reading already knows.
 *
 * Two guards, both of which exist because a model asked for judgement will sometimes give you
 * enthusiasm instead: an id it invented is dropped rather than followed, and an emphasis list that
 * simply restates the ranking changes nothing. Neither is an error worth showing anybody — the
 * edition is composed from the arithmetic, which was always going to be good enough.
 */
export function applyDirection(direction: DesignDirection, signals: EditionSignals): { overrides: Map<string, Importance>; ignored: string[] } {
  const known = new Set(signals.stories.map((s) => s.articleId));
  const overrides = new Map<string, Importance>();
  const ignored: string[] = [];
  for (const item of direction.emphasis) {
    if (!known.has(item.articleId)) {
      ignored.push(item.articleId);
      continue;
    }
    overrides.set(item.articleId, item.importance);
  }
  return { overrides, ignored };
}
