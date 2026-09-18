import { runService, type AiServiceContext } from "./common";
import { creativeBriefSchema, FRAME_LAYOUTS, parseBrief, type CreativeBrief } from "@/lib/creative/brief";
import { FORMATS, MODES, type CreativeFormat, type CreativeMode } from "@/lib/creative/formats";
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

export async function directCreative(input: DirectInput, ctx: AiServiceContext = {}) {
  const format = FORMATS[input.format];
  const mode = MODES[input.mode];
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
    const result = await directCreative(input, ctx);
    const parsed = parseBrief(result.output);
    if (parsed.ok) return { brief: parsed.brief, source: "model", costCents: result.usage.costCents };

    const retry = await directCreative({ ...input, angle: `${input.angle ?? ""}\nYour previous answer could not be rendered: ${parsed.problems.join(" ")}`.trim() }, ctx);
    const second = parseBrief(retry.output);
    if (second.ok) return { brief: second.brief, source: "model", costCents: result.usage.costCents + retry.usage.costCents };
    return { brief: localBrief(input), source: "local", costCents: result.usage.costCents + retry.usage.costCents };
  } catch {
    return { brief: localBrief(input), source: "local", costCents: 0 };
  }
}
