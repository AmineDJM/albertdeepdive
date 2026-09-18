import type { NarrationContext, Pace, SpeechPassage, Style, VoiceDirection, VoiceSettings } from "./types";
import { countWords } from "./script";

/**
 * How the words are to be said.
 *
 * A launch film and a newsletter are not read the same way, and neither is read the way a founder
 * would brief a board. The context sets the performance; the style and pace the person chose bend
 * it; and the result is a small typed record a model may refine but cannot leave. It is deliberately
 * not a prompt: a prompt is prose the next engineer rewrites, a record is a thing the checks can read.
 *
 * Tags are sparse by rule. One well-placed [softly] is direction; a tag on every line is noise the
 * voice performs literally, and the recordings that made everybody wary of "expressive" speech were
 * exactly that.
 */

type ContextBase = { style: Style; pace: Pace; energy: VoiceDirection["energy"]; pauses: VoiceDirection["pauses"]; stance: { en: string; fr: string }; tagDensity: number };

const CONTEXT_BASE: Record<NarrationContext, ContextBase> = {
  launch_film: {
    style: "cinematic",
    pace: "slow",
    energy: "medium",
    pauses: "deliberate",
    tagDensity: 0.8,
    stance: { en: "Cinematic, confident and restrained: every line lands, nothing is sold. Let the pictures breathe; speak as if the audience already leans in.", fr: "Cinématographique, assuré et retenu : chaque phrase porte, rien n'est vendu. Laissez respirer les images ; parlez comme si le public était déjà penché vers vous." },
  },
  newsletter: {
    style: "editorial",
    pace: "natural",
    energy: "medium",
    pauses: "natural",
    tagDensity: 0.6,
    stance: { en: "Editorial and trustworthy: a well-informed colleague reading the edition to you, clear on the facts, warm on the people, never breathless.", fr: "Éditorial et fiable : un collègue bien informé qui vous lit l'édition, précis sur les faits, chaleureux sur les personnes, jamais essoufflé." },
  },
  social: {
    style: "energetic",
    pace: "fast",
    energy: "high",
    pauses: "few",
    tagDensity: 1.2,
    stance: { en: "Energetic and direct: short lines, quick turns, a smile in the voice. Land the hook in the first sentence.", fr: "Énergique et direct : phrases courtes, enchaînements vifs, un sourire dans la voix. L'accroche dès la première phrase." },
  },
  executive: {
    style: "calm",
    pace: "slow",
    energy: "low",
    pauses: "deliberate",
    tagDensity: 0.5,
    stance: { en: "Calm and authoritative: a briefing, not a broadcast. Numbers are given time, conclusions are stated once, plainly.", fr: "Calme et posé : un briefing, pas une émission. On laisse du temps aux chiffres, on énonce les conclusions une fois, simplement." },
  },
  community: {
    style: "warm",
    pace: "natural",
    energy: "medium",
    pauses: "natural",
    tagDensity: 0.8,
    stance: { en: "Warm and close: talking to people you know, proud of what they did, generous with names.", fr: "Chaleureux et proche : on parle à des gens qu'on connaît, fier de ce qu'ils ont fait, généreux avec les prénoms." },
  },
};

/** The tags a style may use, in order of preference. Empty means the style forbids them. */
const TAGS_FOR: Record<Style, string[]> = {
  cinematic: ["[confident]", "[softly]", "[slowly]"],
  professional: ["[confident]", "[calmly]"],
  warm: ["[warmly]", "[softly]"],
  editorial: ["[calmly]", "[confident]"],
  confident: ["[confident]"],
  energetic: ["[excited]", "[cheerfully]"],
  minimal: [],
  calm: ["[calmly]", "[softly]", "[slowly]"],
};

/** The provider-facing numbers for a style. Speed stays near 1: pace is mostly in the words and the pauses. */
const SETTINGS_FOR: Record<Style, Omit<VoiceSettings, "speed">> = {
  cinematic: { stability: 0.45, similarity: 0.85, styleExaggeration: 0.35, speakerBoost: true },
  professional: { stability: 0.65, similarity: 0.8, styleExaggeration: 0.15, speakerBoost: true },
  warm: { stability: 0.5, similarity: 0.85, styleExaggeration: 0.3, speakerBoost: true },
  editorial: { stability: 0.6, similarity: 0.8, styleExaggeration: 0.2, speakerBoost: true },
  confident: { stability: 0.55, similarity: 0.8, styleExaggeration: 0.3, speakerBoost: true },
  energetic: { stability: 0.35, similarity: 0.75, styleExaggeration: 0.5, speakerBoost: true },
  minimal: { stability: 0.75, similarity: 0.8, styleExaggeration: 0, speakerBoost: false },
  calm: { stability: 0.7, similarity: 0.85, styleExaggeration: 0.1, speakerBoost: true },
};

/**
 * Speed by pace. Narrow on purpose: a narration that does not fit its slot is rewritten shorter,
 * never played faster. Above about 1.08 a voice starts to sound hurried, and that is the one thing
 * a premium narration must never sound.
 */
export const SPEED_FOR: Record<Pace, number> = { slow: 0.93, natural: 1, fast: 1.06 };

/** The context a narration kind is heard in, unless the person said otherwise. */
export function contextForKind(kind: string): NarrationContext {
  switch (kind) {
    case "VIDEO":
      return "launch_film";
    case "EXECUTIVE":
      return "executive";
    case "SUMMARY":
      return "newsletter";
    default:
      return "newsletter";
  }
}

/** The direction before any model has seen it: what the context and the choices say on their own. */
export function baseDirection(input: { context: NarrationContext; style?: Style | null; pace?: Pace | null; locale?: "en" | "fr" }): VoiceDirection {
  const base = CONTEXT_BASE[input.context];
  const style = input.style ?? base.style;
  const pace = input.pace ?? base.pace;
  return {
    context: input.context,
    style,
    pace,
    energy: style === "energetic" ? "high" : style === "calm" || style === "minimal" ? "low" : base.energy,
    stance: base.stance[input.locale ?? "en"],
    tags: TAGS_FOR[style],
    tagDensity: style === "minimal" ? 0 : base.tagDensity,
    pauses: pace === "slow" ? "deliberate" : pace === "fast" ? "few" : base.pauses,
    settings: { ...SETTINGS_FOR[style], speed: SPEED_FOR[pace] },
    source: "local",
  };
}

/** A direction a model refined, kept inside the closed lists whatever it answered. */
export function refineDirection(base: VoiceDirection, refined: { stance?: string | null; energy?: VoiceDirection["energy"] | null; pauses?: VoiceDirection["pauses"] | null; tags?: string[] | null }): VoiceDirection {
  const allowed = new Set(base.tags);
  return {
    ...base,
    stance: refined.stance?.trim() || base.stance,
    energy: refined.energy ?? base.energy,
    pauses: refined.pauses ?? base.pauses,
    tags: refined.tags ? refined.tags.filter((tag) => allowed.has(tag)) : base.tags,
    source: "model",
  };
}

/** How many tags a passage may carry: the density, rounded down, never below one for a passage that opens something. */
export function tagBudget(passage: SpeechPassage, direction: VoiceDirection): number {
  if (!direction.tags.length || direction.tagDensity <= 0) return 0;
  const words = countWords(passage.text);
  return Math.floor((words / 100) * direction.tagDensity) + (passage.sourceType === "intro" || passage.sourceType === "headline" || passage.sourceType === "scene" || passage.sourceType === "quote" ? 1 : 0);
}

/** The tags already on a passage, in order. */
export function tagsIn(text: string): string[] {
  return text.match(/\[[a-zA-Z][a-zA-Z ]{1,24}\]/g) ?? [];
}

/**
 * Place the few tags a performance wants, when no model did.
 *
 * The opening of a chapter takes the style's first tag; a quotation is said [softly] where the
 * style allows it; everything else is left to the voice. Tags a model placed are kept when they are
 * in the palette and within budget, and dropped otherwise — a tag outside the palette is a tag the
 * direction never asked for.
 */
export function decorateWithTags(passages: SpeechPassage[], direction: VoiceDirection): SpeechPassage[] {
  const palette = new Set(direction.tags);
  let lastChapter: string | null | undefined = undefined;
  return passages.map((passage) => {
    const opensChapter = passage.chapter !== lastChapter && passage.chapter !== null && passage.chapter !== undefined;
    // A chapter's first words may always carry the style's tag: it is where a listener hears a change.
    const budget = Math.max(tagBudget(passage, direction), opensChapter && direction.tags.length && direction.tagDensity > 0 ? 1 : 0);
    const existing = tagsIn(passage.text).filter((tag) => palette.has(tag));
    let text = passage.text.replace(/\[[a-zA-Z][a-zA-Z ]{1,24}\]\s*/g, "");
    const chosen: string[] = existing.slice(0, budget);
    if (!chosen.length && budget > 0) {
      if (passage.sourceType === "quote" && palette.has("[softly]")) chosen.push("[softly]");
      else if (opensChapter || passage.sourceType === "intro" || passage.sourceType === "scene") chosen.push(direction.tags[0]);
    }
    lastChapter = passage.chapter;
    if (chosen.length) text = `${chosen[0]} ${text}`;
    return { ...passage, text: text.trim() };
  });
}
