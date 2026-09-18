import { z } from "zod";
import { CREATIVE_FORMATS, CREATIVE_MODES } from "./formats";
import { MAX_HASHTAGS } from "./laws";
import { IMAGERY_TREATMENTS, SURFACE_KEYS } from "@/lib/brand/system";

/**
 * What the Art Director is allowed to say.
 *
 * This is the whole safety property of Creative Studio, expressed as a schema. A model writes one of
 * these and nothing else: it chooses what to communicate, in what order, on which named surface, with
 * which named emphasis. It cannot choose a hex colour, a font, a weight, a pixel, a coordinate or a
 * size, because none of those words exist here. Everything it names is something the design system
 * can execute exactly.
 *
 * That constraint is not caution about models, it is how the output stops looking generated. A system
 * that lets a model pick "a nice dark blue at 42px" produces work with no house style, because there
 * is no house — every slide is a fresh opinion. A system that lets it pick "brand surface, loud" and
 * then renders that the same way every time has one.
 *
 * The other half of the rule: `text` here is the final text. It is drawn by the renderer, as real
 * type, on the real canvas. No image model is ever asked to produce a picture that contains the
 * words. That is what makes the letters correct, the kerning ours, and a typo fixable.
 */

export const EMPHASIS = ["quiet", "normal", "loud"] as const;
export type Emphasis = (typeof EMPHASIS)[number];

/** The shapes a frame can take. Each is a layout the renderer knows how to build. */
export const FRAME_LAYOUTS = [
  /** A statement, set large, alone. Openers and closers. */
  "statement",
  /** A short heading over a paragraph. The workhorse. */
  "heading_body",
  /** One number, enormous, with a line explaining it. */
  "figure",
  /** Somebody's words, attributed. */
  "quote",
  /** A short list, two to five items. */
  "list",
  /** A photograph filling the frame, with type over it. */
  "image_full",
  /** A photograph above, type below. */
  "image_top",
  /** A call to action: one line and a destination. */
  "cta",
] as const;
export type FrameLayout = (typeof FRAME_LAYOUTS)[number];

const shortText = z.string().trim().min(1).max(180);
const bodyText = z.string().trim().min(1).max(420);

export const frameBriefSchema = z.object({
  layout: z.enum(FRAME_LAYOUTS),
  /** The one thing this frame says. Rendered as real type, never as a picture of type. */
  headline: shortText,
  body: bodyText.optional(),
  /** For `figure`: the number itself, already formatted for a reader. "€1.2M", "340", "3×". */
  figure: z.string().trim().min(1).max(24).optional(),
  /** For `quote`. */
  attribution: shortText.optional(),
  /** For `list`. Two to five, each short enough to read at a glance. */
  items: z.array(shortText).min(2).max(5).optional(),
  /** Which of the brand's surfaces this frame sits on. Named, never a colour. */
  surface: z.enum(SURFACE_KEYS),
  emphasis: z.enum(EMPHASIS),
  /**
   * Which of the organisation's own photographs to use, by the id it was offered under.
   *
   * The Art Director picks from a list it was given. It cannot name a file that was not offered, and
   * it cannot describe an image for something else to generate — in Cinematic mode the generation
   * request is built by the composer from the brand and the layout, not from a model's prose.
   */
  mediaId: z.string().uuid().optional(),
  /** Alt text for this frame, written by the same pass that wrote the headline. */
  alt: z.string().trim().min(1).max(280).optional(),
});

export type FrameBrief = z.infer<typeof frameBriefSchema>;

export const creativeBriefSchema = z.object({
  format: z.enum(CREATIVE_FORMATS),
  mode: z.enum(CREATIVE_MODES),
  /** The one sentence this pack exists to land. Not rendered; it is the yardstick for the rest. */
  intent: z.string().trim().min(1).max(280),
  frames: z.array(frameBriefSchema).min(1).max(10),
  /** The post's own text, which goes in the caption box rather than on the image. */
  caption: z.string().trim().min(1).max(2200),
  /** More is a tell, and platforms weight them less every year. The cap is the law's, not a second copy of it. */
  hashtags: z.array(z.string().trim().regex(/^[\p{L}\p{N}_]{2,40}$/u)).max(MAX_HASHTAGS),
  /** How the imagery is treated, from the brand's own menu. */
  treatment: z.enum(IMAGERY_TREATMENTS).optional(),
});

export type CreativeBrief = z.infer<typeof creativeBriefSchema>;

/* ── The resolved spec ────────────────────────────────────────────────────────────────────── */

/**
 * What the renderer draws.
 *
 * Fully resolved: every colour a hex, every size a number, every box a rectangle. Produced from a
 * brief and a brand by a pure function, so the same pair always yields the same spec — which is what
 * makes a rendered carousel reproducible, a golden test meaningful, and a re-render a year from now
 * identical rather than merely similar.
 *
 * Nothing in here came from a model. The model chose `surface: "brand"` and `emphasis: "loud"`; this
 * is what those mean.
 */
export type TextBlock = {
  role: "display" | "text" | "label" | "figure";
  /**
   * Whether this block is read or merely seen.
   *
   * A design system's furniture can be either. The report's header is information and must never sit
   * on the content; the poster's ghosted numeral is texture and is *supposed* to sit behind it. Both
   * are text blocks, and without this the renderer and the overlap check cannot tell them apart —
   * which means either the numeral is rejected as a collision or a real collision is missed.
   *
   * Background blocks are drawn first, so content always sits on top.
   */
  layer?: "background" | "content";
  content: string;
  x: number;
  y: number;
  width: number;
  /** Resolved from the brand's type scale — never interpolated between steps. */
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  letterSpacing: number;
  lineHeight: number;
  colour: string;
  transform: "none" | "uppercase";
  align: "left" | "center" | "right";
  /** How many lines it is expected to take, from measurement rather than guesswork. */
  lines: number;
};

export type ShapeBlock = {
  kind: "rect" | "rule" | "dot";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  colour: string;
};

export type ImageBlock = {
  /** The media asset to draw, or null when the frame's picture is to be generated. */
  mediaId: string | null;
  /** Set when the picture must be produced before this frame can render. */
  generate?: { treatment: string; palette: string[]; subject: "abstract" | "texture" | "gradient" };
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0–1, applied as a scrim so type over the image stays readable. */
  dim: number;
  /** 0–1 grain, which is the cheapest way to stop a render looking synthetic. */
  grain: number;
  duotone?: { from: string; to: string };
};

export type FrameSpec = {
  index: number;
  layout: FrameLayout;
  width: number;
  height: number;
  background: string;
  image?: ImageBlock;
  shapes: ShapeBlock[];
  text: TextBlock[];
  /** What a screen reader is told, and what goes in the platform's alt field. */
  alt: string;
};

export type RenderSpec = {
  format: string;
  mode: string;
  /** Which design system composed it, so a re-render reproduces the same treatment. */
  system: string;
  width: number;
  height: number;
  frames: FrameSpec[];
  caption: string;
  hashtags: string[];
  /** The brand version this was resolved against, so a re-render can be exact. */
  brandVersion: string;
  /** Stable hash of everything above. Two identical specs render to identical files. */
  fingerprint: string;
};

/**
 * Parse whatever a model returned, and say plainly what was wrong with it.
 *
 * Models produce almost-valid JSON often enough that this is a normal path rather than an error
 * path: a missing `body` on a `heading_body` frame is a retry, not a crash. The messages are written
 * to be fed back to the model verbatim.
 */
export function parseBrief(raw: unknown): { ok: true; brief: CreativeBrief } | { ok: false; problems: string[] } {
  const parsed = creativeBriefSchema.safeParse(raw);
  if (parsed.success) {
    const problems = [...structuralProblems(parsed.data), ...unattributedQuotations(parsed.data)];
    return problems.length ? { ok: false, problems } : { ok: true, brief: parsed.data };
  }
  return {
    ok: false,
    problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "brief"}: ${issue.message}`),
  };
}

/**
 * The rules a schema cannot express.
 *
 * A `figure` frame without a figure, a `quote` without an attribution, a `list` without items: each
 * is structurally valid JSON and a frame the renderer cannot draw. Checking here rather than in the
 * renderer means the failure is a sentence the model can act on instead of an empty box on a slide.
 */
function structuralProblems(brief: CreativeBrief): string[] {
  const problems: string[] = [];
  brief.frames.forEach((frame, index) => {
    const where = `frames[${index}]`;
    if (frame.layout === "figure" && !frame.figure) problems.push(`${where}: a figure frame needs "figure", the number itself.`);
    if (frame.layout === "quote" && !frame.attribution) problems.push(`${where}: a quote frame needs "attribution" — who said it.`);
    if (frame.layout === "list" && !frame.items?.length) problems.push(`${where}: a list frame needs "items".`);
    if (frame.layout === "heading_body" && !frame.body) problems.push(`${where}: a heading_body frame needs "body".`);
    if ((frame.layout === "image_full" || frame.layout === "image_top") && !frame.mediaId) {
      problems.push(`${where}: an image layout needs "mediaId", chosen from the media you were offered.`);
    }
  });
  if (brief.frames.every((frame) => frame.surface === brief.frames[0].surface) && brief.frames.length > 2) {
    problems.push("Every frame is on the same surface. Vary it: a set that never changes ground reads as one long slide.");
  }
  return problems;
}

/**
 * A quoted passage set anywhere but a quote frame, with nobody's name against it.
 *
 * The `quote` layout already requires an attribution. This catches the other way a quotation reaches
 * a slide: a model that puts somebody's words in quotation marks inside a `statement` headline,
 * where the schema is satisfied and the reader is shown a claim in costume. Journalistic practice,
 * enforced rather than reported, because the fix — name the speaker, or stop quoting — is not a
 * design decision Briefly may take on somebody's behalf.
 *
 * Deliberately narrow: a matched pair of double quotes around a real sentence. Apostrophes, single
 * quotes and two-word scare quotes are left alone, because flagging those would teach people to
 * ignore the check.
 */
const QUOTED_PASSAGE = /["“]([^"”]{25,})["”]/;

export function unattributedQuotations(brief: CreativeBrief): string[] {
  return brief.frames.flatMap((frame, index) => {
    if (frame.layout === "quote" || frame.attribution) return [];
    const found = [frame.headline, frame.body].filter(Boolean).find((text) => QUOTED_PASSAGE.test(text!));
    if (!found) return [];
    return [`frames[${index}]: "${QUOTED_PASSAGE.exec(found)![1].slice(0, 40)}…" is quoted with nobody's name against it. Use a quote frame with an attribution, or say it in your own words.`];
  });
}
