import { z } from "zod";
import { DESIGN_MOODS } from "@/lib/design/genome";
import { RECURRING_COMPONENTS } from "@/lib/design/identity";
import { PERSONALITY_KEYS } from "@/lib/brand/typography";
import { runService, type AiServiceContext } from "./common";
import type { TaskImage } from "../types";
import { runAiTask } from "../run";

/**
 * Reading somebody's newsletter and saying what kind of thing it is.
 *
 * The measurements are already in: the page size, the families, the colours, the running order.
 * What a file cannot state is the judgement — whether this is a quiet two-column broadsheet or a
 * loud single column, whether the masthead sits over a rule or beside the date, and which of its
 * headings are rubrics that come back every month rather than one issue's headlines.
 *
 * So the vocabulary here is deliberately the same closed one the design director already works in:
 * a mood, a handful of dials, a cover approach, a grid, and the components this title always has.
 * It may not name a typeface or a hex value, because those were *measured* and handing them to a
 * model to repeat is how a red that was #c8102e comes back as "a warm red" and then as #cc0000.
 */

export const blueprintReadingSchema = z.object({
  /** The one word that carries the whole genome; the dials below move it from there. */
  mood: z.enum(DESIGN_MOODS),
  /** Only the dials this title genuinely departs on. Silence is inherited, not neutral. */
  genome: z.object({
    density: z.number().min(0).max(1).optional(),
    formality: z.number().min(0).max(1).optional(),
    playfulness: z.number().min(0).max(1).optional(),
    seriousness: z.number().min(0).max(1).optional(),
    minimalism: z.number().min(0).max(1).optional(),
    colourIntensity: z.number().min(0).max(1).optional(),
    typographicVoice: z.enum(["quiet", "confident", "expressive"]).optional(),
    imageUsage: z.enum(["sparse", "balanced", "led"]).optional(),
    ornament: z.number().min(0).max(1).optional(),
    variation: z.number().min(0).max(1).optional(),
  }),
  /** Which of the four type personalities the measured families read as. */
  personality: z.enum(PERSONALITY_KEYS).nullable(),
  masthead: z.object({
    composition: z.enum(["classic", "centred", "left", "stacked", "banner"]),
    wordmark: z.enum(["logo", "type", "both"]),
    rule: z.boolean(),
  }),
  grid: z.object({
    columns: z.number().int().min(1).max(16),
    shape: z.enum(["single", "two-column", "three-column", "asymmetric", "modular", "digital-12"]),
  }),
  coverStyle: z.enum(["image-led", "typographic", "portrait-led", "data-led", "minimal", "collage"]).nullable(),
  sectionOpener: z.enum(["full-title", "rule-and-number", "image-band", "quote-led", "colour-field"]).nullable(),
  /**
   * The rubrics this title runs every month, in the order they appear.
   *
   * Judgement, not counting: "Édito" at the top of every issue is a rubric and "Marie remporte le
   * prix" is a headline, and the only way to tell them apart is to read them. The name is kept
   * exactly as the source wrote it, because a newsletter whose rubric becomes "Editorial" when it
   * has always said "Édito" is not the same newsletter.
   */
  sections: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        /** What goes in it, in one line, for the editor who did not make the original. */
        purpose: z.string().max(160),
        /** The nearest thing Briefly already knows how to compose, when there is one. */
        component: z.enum(RECURRING_COMPONENTS).nullable(),
      }),
    )
    .max(12),
  /** What was understood, in two or three sentences, for the person about to adopt it. */
  summary: z.string().max(600),
  /** How much of this is reading and how much is inference from very little. */
  confidence: z.enum(["high", "medium", "low"]),
});
export type BlueprintReading = z.infer<typeof blueprintReadingSchema>;

export type BlueprintReaderInput = {
  /** The measurements, written as sentences. See `describeEvidence`. */
  evidence: string;
  /** The organisation this title belongs to, so the reading is not made in a vacuum. */
  organizationName: string;
  publicationName: string;
  /** What the workspace's own brand already says, which a model must not contradict for no reason. */
  brand: string;
  /** Pictures of the pages, when the format allowed any to be drawn. */
  shots?: TaskImage[];
};

export async function readBlueprint(input: BlueprintReaderInput, ctx: AiServiceContext = {}) {
  const { shots, ...words } = input;
  // `runService` is the ordinary path and carries no pictures; a reading with shots goes to the
  // task runner directly rather than widening every service's signature for one of them.
  if (!shots?.length) {
    return runService({ service: "blueprint_reader", schemaName: "blueprint_reading", schema: blueprintReadingSchema, input: words, ctx });
  }
  return runAiTask({
    service: "blueprint_reader",
    promptKey: "blueprint_reader",
    input: words,
    schema: blueprintReadingSchema,
    schemaName: "blueprint_reading",
    images: shots,
    editionId: ctx.editionId ?? null,
    entityType: ctx.entityType,
    entityId: ctx.entityId ?? null,
    cacheable: ctx.cacheable,
    jobId: ctx.jobId ?? null,
  });
}
