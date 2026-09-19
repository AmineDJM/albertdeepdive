import { runService, type AiServiceContext } from "./common";
import { creativeBriefSchema, FRAME_LAYOUTS, parseBrief, type CreativeBrief } from "@/lib/creative/brief";
import { FORMATS, MODES, hookWords, orientationOf, type CreativeFormat, type CreativeMode } from "@/lib/creative/formats";
import { brandMenu, type BrandSystem } from "@/lib/brand/system";

/**
 * The Art Director.
 *
 * It decides what to say, in what order, on which of the brand's named surfaces, at which named
 * emphasis. It does not decide a colour, a typeface, a weight, a size or a position, because the
 * schema it must answer in has no words for any of those. Everything it names, the design system can
 * execute exactly.
 *
 * That boundary is the reason Creative Studio's output does not look generated. A model allowed to
 * specify "a bold sans at 42px in #1a1a2e" produces work with no house style — every slide is a
 * fresh opinion, and the set has nothing in common but a logo. A model that may only say "brand
 * surface, loud" produces work with one, because the answer to "what does loud look like" is written
 * down once.
 *
 * The other half: the text here is the final text, drawn by our renderer as real type. No image
 * model is ever asked for a picture containing the words. That is what makes the letters correct,
 * the kerning ours, and a typo a two-second fix rather than a regeneration.
 */

export type SourceStory = {
  id: string;
  headline: string;
  standfirst?: string | null;
  body?: string | null;
  section?: string | null;
  /** Figures worth putting on a slide, already formatted for a reader. */
  figures?: string[];
  quotes?: { text: string; attribution: string }[];
};

export type OfferedMedia = { id: string; description: string; orientation?: string | null };

export type DirectInput = {
  format: CreativeFormat;
  mode: CreativeMode;
  organizationName: string;
  brand: BrandSystem;
  /** What this pack is made from. One story, or the highlights of a whole edition. */
  stories: SourceStory[];
  /** Photographs the Art Director may place, by id. It may not name anything absent from this list. */
  media?: OfferedMedia[];
  /** A steer from the person, when they gave one. */
  angle?: string | null;
};

function describeStories(stories: SourceStory[]): string {
  return stories
    .map((story, index) => {
      const parts = [`— Story ${index + 1} (id ${story.id}): ${story.headline}`];
      if (story.standfirst) parts.push(`Standfirst: ${story.standfirst}`);
      if (story.section) parts.push(`Section: ${story.section}`);
      if (story.figures?.length) parts.push(`Figures worth showing: ${story.figures.join(", ")}`);
      if (story.quotes?.length) parts.push(story.quotes.map((quote) => `Quote: "${quote.text}" — ${quote.attribution}`).join("\n"));
      if (story.body) parts.push(story.body.slice(0, 1200));
      return parts.join("\n");
    })
    .join("\n\n");
}

/**
 * How the shape changes what is worth writing.
 *
 * Not decoration for the prompt: a vertical cut and a landscape cut made from the same material
 * are two different pieces of writing, and the difference is not length. A feed cut is watched
 * with a thumb resting on the glass by somebody already leaving; it opens on the sharpest thing
 * there is, turns over faster and pays off earlier. A landscape cut is played on a screen somebody
 * chose; it can set something up and be trusted to arrive.
 *
 * The moving shapes carry that as data — `attention` on the format — so the brief, the timeline
 * and the check that reports a film too slow to hold anybody all read the same numbers. The stills
 * keep an orientation note, because a carousel's "hook" is frame one and the prompt already says
 * so at length.
 */
const STILL_NOTES: Record<"portrait" | "landscape" | "square", string> = {
  portrait: "Tall, seen full-screen for about three seconds. One idea per frame, and it has to land at a glance.",
  landscape: "Wide. A frame can carry a sentence and the figure that proves it.",
  square: "Square, in a feed that scrolls past it. A short claim per frame, with room beneath it for the evidence.",
};

/** What the art director is told about the shape it is writing for. */
export function shapeBrief(format: CreativeFormat): { note: string; beats: string; hook: string } {
  const definition = FORMATS[format];
  const attention = definition.attention;
  if (!attention) return { note: STILL_NOTES[orientationOf(format)], beats: "—", hook: "—" };
  return {
    note: attention.note,
    beats: attention.beats.map((beat, index) => `${index + 1}. ${beat}`).join("\n"),
    hook: `The first shot has ${attention.hookSeconds}s before somebody decides — about ${hookWords(attention)} words. It is on screen for exactly as long as its own words take to read, so a long opening line is a slow opening shot.`,
  };
}

export async function directCreative(input: DirectInput, ctx: AiServiceContext = {}) {
  const format = FORMATS[input.format];
  const mode = MODES[input.mode];
  const shape = shapeBrief(input.format);
  const menu = brandMenu(input.brand);

  return runService({
    service: "art_director",
    schemaName: "creative_brief",
    schema: creativeBriefSchema,
    tier: "STRONG",
    maxOutputTokens: 2400,
    input: {
      organizationName: input.organizationName,
      format: input.format,
      formatName: format.name,
      formatDescription: format.description,
      minFrames: format.minFrames,
      maxFrames: format.maxFrames,
      moving: format.moving,
      orientation: orientationOf(input.format),
      shapeNote: shape.note,
      beats: shape.beats,
      hook: shape.hook,
      mode: input.mode,
      modeDescription: mode.description,
      mayUseOwnPhotographs: mode.usesOwnMedia && (input.media?.length ?? 0) > 0,
      layouts: FRAME_LAYOUTS.join(", "),
      surfaces: menu.surfaces.join(", "),
      emphasis: menu.emphasis.join(", "),
      treatments: menu.treatments.join(", "),
      tone: menu.voice.tone.join(", ") || "plain",
      person: menu.voice.person === "first" ? `first person — "we"` : `third person — "${input.organizationName}"`,
      avoid: menu.voice.avoid.join(", ") || "—",
      angle: input.angle ?? "—",
      stories: describeStories(input.stories),
      media: input.media?.length ? input.media.map((item) => `${item.id}: ${item.description}${item.orientation ? ` (${item.orientation})` : ""}`).join("\n") : "none — do not use an image layout",
    },
    ctx,
  });
}

/* ── Without a model ──────────────────────────────────────────────────────────────────────── */

/**
 * A brief built from the material itself, when no model is configured.
 *
 * Not a placeholder. It is a real editorial pattern — open with the claim, give the evidence, close
 * with where to read more — applied to whatever the story actually contains, and it renders through
 * exactly the same composer and design system as a directed one. A workspace with no OpenAI key gets
 * carousels that look like their brand and say true things, which is a long way from nothing.
 *
 * Deterministic: same stories in, same brief out. No sampling, no clock.
 */
/** Splits a paragraph into sentences, so a feed cut can give each one its own shot. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

/**
 * The same material, cut for a feed.
 *
 * Not the classic pattern with fewer frames: a different order. The number goes first, because a
 * figure is one word and one word is a hook that can be read inside a second and a half — where
 * the eight-word headline it belongs to cannot. What follows turns over faster and carries less
 * per shot: the standfirst becomes a shot per sentence instead of one dense paragraph, the quote
 * escalates rather than decorates, and the round-up of everything else in the issue is dropped
 * outright, because a feed cut that lists five other stories has told somebody it has nothing.
 *
 * Nothing here is truncated to fit. A headline that takes longer than the hook is left whole and
 * the motion check reports `slow_hook` — an honest finding for a writer to answer, rather than a
 * sentence cut in half by arithmetic.
 */
function feedFrames(input: DirectInput, lead: DirectInput["stories"][number], photograph: { id: string; description: string } | undefined): CreativeBrief["frames"] {
  const frames: CreativeBrief["frames"] = [];
  const figure = lead.figures?.[0];
  const quote = lead.quotes?.[0];

  /*
   * The hook. A figure alone is the sharpest thing this generator can be sure of.
   *
   * Set as a statement rather than through the `figure` layout, which pairs a number with the line
   * that explains it — two thoughts, and the explaining line is nine words nobody has time for.
   * Here the number is the whole shot, at display size, and the line it belongs to is the shot
   * after it.
   */
  if (figure) frames.push({ layout: "statement", headline: figure, surface: "ink", emphasis: "loud", alt: `${figure} — ${lead.headline}` });
  else if (photograph) frames.push({ layout: "image_full", headline: lead.headline, surface: "ink", emphasis: "loud", mediaId: photograph.id, alt: photograph.description });
  else frames.push({ layout: "statement", headline: lead.headline, surface: "brand", emphasis: "loud", alt: lead.headline });

  // What it was about, once they have stayed for it.
  if (figure) {
    frames.push(
      photograph
        ? { layout: "image_full", headline: lead.headline, surface: "ink", emphasis: "loud", mediaId: photograph.id, alt: photograph.description }
        : { layout: "statement", headline: lead.headline, surface: "brand", emphasis: "loud", alt: lead.headline },
    );
  }

  // One sentence a shot: shorter shots, more of them, and the turnover is the point.
  for (const sentence of sentences(lead.standfirst ?? "").slice(0, 3)) {
    frames.push({ layout: "statement", headline: sentence, surface: "paper", emphasis: "normal" });
  }

  if (quote) frames.push({ layout: "quote", headline: quote.text.slice(0, 180), attribution: quote.attribution, surface: "paper", emphasis: "loud" });

  // Tight, not a fade: three words and the name of who is publishing.
  frames.push({ layout: "cta", headline: "Read it", body: input.organizationName, surface: "accent", emphasis: "normal" });
  return frames;
}

export function localBrief(input: DirectInput): CreativeBrief {
  const format = FORMATS[input.format];
  const [lead, ...rest] = input.stories;
  if (!lead) {
    return {
      format: input.format,
      mode: input.mode,
      intent: `Introduce ${input.organizationName}.`,
      frames: [{ layout: "statement", headline: input.organizationName, surface: "brand", emphasis: "loud" }],
      caption: `${input.organizationName}.`,
      hashtags: [],
    };
  }

  /*
   * The opener carries the claim, as loud as the system goes — over a photograph when the newsroom
   * has one cleared to use, on the brand's own colour when it has not. A picture is offered here
   * only in the modes that use the organisation's own media, so a frame can never name one that
   * was not offered; that is the whole safety property, kept by construction.
   */
  const photograph = MODES[input.mode].usesOwnMedia ? input.media?.[0] : undefined;

  // A feed cut is a different film from the same material, not a shorter one, so it is built by
  // its own pattern rather than by trimming this one.
  if (format.attention && format.attention.driftScale > 1) {
    const cut = feedFrames(input, lead, photograph);
    const fitted = cut.length > format.maxFrames ? [...cut.slice(0, format.maxFrames - 1), cut[cut.length - 1]] : [...cut];
    while (fitted.length < format.minFrames) fitted.splice(fitted.length - 1, 0, { layout: "statement", headline: lead.headline, surface: "ink", emphasis: "normal" });
    return {
      format: input.format,
      mode: input.mode,
      intent: lead.standfirst ?? lead.headline,
      frames: fitted,
      caption: [lead.headline, lead.standfirst, `— ${input.organizationName}`].filter(Boolean).join("\n\n").slice(0, 2200),
      hashtags: [],
    };
  }

  const frames: CreativeBrief["frames"] = [
    photograph
      ? { layout: "image_full", headline: lead.headline, surface: "ink", emphasis: "loud", mediaId: photograph.id, alt: photograph.description }
      : { layout: "statement", headline: lead.headline, surface: "brand", emphasis: "loud", alt: lead.headline },
  ];

  if (lead.standfirst) {
    frames.push({ layout: "heading_body", headline: "What happened", body: lead.standfirst, surface: "paper", emphasis: "normal" });
  }

  const figure = lead.figures?.[0];
  if (figure) {
    frames.push({ layout: "figure", headline: lead.headline.slice(0, 90), figure, surface: "ink", emphasis: "loud" });
  }

  const quote = lead.quotes?.[0];
  if (quote) {
    // On paper rather than on a fifth ground. 60/30/10: one surface has to hold the set, and a
    // carousel that changes colour on every slide has no dominant, no structure and nothing that
    // points — the eye cannot tell what it is being shown. Paper is the workhorse here, ink is the
    // one structural contrast (the figure), accent is the single moment that points (the close).
    frames.push({ layout: "quote", headline: quote.text.slice(0, 180), attribution: quote.attribution, surface: "paper", emphasis: "normal" });
  }

  // Everything else in the edition becomes one list frame rather than a slide each: a carousel that
  // gives every story equal weight has no lead, and a reader stops at slide three regardless.
  const others = rest.map((story) => story.headline).slice(0, 5);
  if (others.length >= 2) {
    frames.push({ layout: "list", headline: "Also this month", items: others, surface: "paper", emphasis: "quiet" });
  }

  frames.push({
    layout: "cta",
    headline: "Read the whole thing",
    body: `The full edition from ${input.organizationName}.`,
    surface: "accent",
    emphasis: "normal",
  });

  // Trim from the middle, never from the end. A Story holds five frames and this pattern builds six,
  // so slicing the tail drops the close — the one frame that tells a reader what to do next, and the
  // only one besides the opener that has a job nothing else can do. The evidence in the middle is
  // what a set can afford to lose.
  const trimmed = frames.length > format.maxFrames ? [...frames.slice(0, format.maxFrames - 1), frames[frames.length - 1]] : [...frames];
  while (trimmed.length < format.minFrames) {
    trimmed.push({ layout: "statement", headline: input.organizationName, surface: "ink", emphasis: "normal" });
  }

  return {
    format: input.format,
    mode: input.mode,
    intent: lead.standfirst ?? lead.headline,
    frames: trimmed,
    caption: [lead.headline, lead.standfirst, `— ${input.organizationName}`].filter(Boolean).join("\n\n").slice(0, 2200),
    hashtags: [],
  };
}

/**
 * A brief from the model when there is one, and from the material when there is not.
 *
 * Also the retry: a model that returns something the renderer cannot draw is told exactly what was
 * wrong, once, and if it fails again the local pattern is used rather than showing somebody an
 * error. A carousel that is merely good beats a dialog box.
 */
export async function briefFor(input: DirectInput, ctx: AiServiceContext = {}): Promise<{ brief: CreativeBrief; source: "model" | "local"; costCents: number }> {
  try {
    const asked = { format: input.format, mode: input.mode };
    const result = await directCreative(input, ctx);
    const parsed = parseBrief(result.output, asked);
    if (parsed.ok) return { brief: parsed.brief, source: "model", costCents: result.usage.costCents };

    const retry = await directCreative({ ...input, angle: `${input.angle ?? ""}\nYour previous answer could not be rendered: ${parsed.problems.join(" ")}`.trim() }, ctx);
    const second = parseBrief(retry.output, asked);
    if (second.ok) return { brief: second.brief, source: "model", costCents: result.usage.costCents + retry.usage.costCents };
    return { brief: localBrief(input), source: "local", costCents: result.usage.costCents + retry.usage.costCents };
  } catch {
    return { brief: localBrief(input), source: "local", costCents: 0 };
  }
}
