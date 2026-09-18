import type { SpeechLanguage } from "./language";
import type { Pace } from "./types";
import { countWords, stripTags } from "./script";

/**
 * How long words take to say.
 *
 * Narration runs slower than conversation and slower than the 180 words a minute a viewer reads
 * on-screen text at: an audiobook sits near 150 in English, and French, with its lighter syllables,
 * a little above. The point of knowing this before a single second is generated is the rule it
 * enforces — a passage that will not fit its slot is rewritten shorter, in advance, rather than
 * played faster afterwards. A narration sped up is a narration that sounds sped up.
 */

export const WORDS_PER_MINUTE: Record<SpeechLanguage, number> = { en: 150, fr: 160, es: 160, de: 140, it: 160, pt: 155, nl: 150 };

export const PACE_FACTOR: Record<Pace, number> = { slow: 0.88, natural: 1, fast: 1.1 };

/** A breath at a full stop, a longer one at a paragraph. */
const SENTENCE_PAUSE = 0.35;
const PARAGRAPH_PAUSE = 0.6;

export function estimateSeconds(text: string, language: SpeechLanguage, pace: Pace = "natural"): number {
  const plain = stripTags(text);
  const words = countWords(plain);
  const sentences = Math.max(1, (plain.match(/[.!?…](\s|$)/g) ?? []).length);
  const paragraphs = Math.max(0, (plain.match(/\n\s*\n/g) ?? []).length);
  const rate = (WORDS_PER_MINUTE[language] * PACE_FACTOR[pace]) / 60;
  return Math.round((words / rate + sentences * SENTENCE_PAUSE + paragraphs * PARAGRAPH_PAUSE) * 100) / 100;
}

/** How many words fit in a number of seconds, leaving room for the pauses a sentence needs. */
export function wordsThatFit(seconds: number, language: SpeechLanguage, pace: Pace = "natural"): number {
  const rate = (WORDS_PER_MINUTE[language] * PACE_FACTOR[pace]) / 60;
  return Math.max(0, Math.floor((seconds - SENTENCE_PAUSE) * rate));
}

/**
 * How much longer a scene may be held to fit its words.
 *
 * A film's scenes are timed for reading; narration of the same words takes a little longer, and
 * holding the picture for it is right. Holding it half again as long is not: the film stalls, and
 * the fix is fewer words, decided before the voice is paid for.
 */
export const MAX_HOLD_STRETCH = 1.35;

/** The lead-in before the first word and the tail after the last, so speech never starts on a cut. */
export const SCENE_PADDING_SECONDS = 0.3;

export type SceneFit = { fits: boolean; estimatedSeconds: number; maxWords: number; overBySeconds: number };

/** Whether these words fit this scene, and if not, how many would. */
export function fitToScene(text: string, holdSeconds: number, language: SpeechLanguage, pace: Pace = "natural"): SceneFit {
  const estimatedSeconds = estimateSeconds(text, language, pace);
  const room = holdSeconds * MAX_HOLD_STRETCH - SCENE_PADDING_SECONDS;
  return { fits: estimatedSeconds <= room, estimatedSeconds, maxWords: wordsThatFit(room, language, pace), overBySeconds: Math.max(0, Math.round((estimatedSeconds - room) * 100) / 100) };
}

/**
 * The holds a film actually needs once its narration exists.
 *
 * Each scene is held for at least its reading time and at least its narration plus a breath. A
 * narration that overran even the stretch is still given its time — cutting a voice mid-word is
 * worse than a long shot — and the overrun is reported so the words can be cut next time.
 */
export function holdsForNarration(scenes: { hold: number }[], durations: (number | null)[]): { holds: number[]; overruns: number[] } {
  const overruns: number[] = [];
  const holds = scenes.map((scene, index) => {
    const spoken = durations[index];
    if (spoken === null || spoken === undefined) return scene.hold;
    const needed = spoken + SCENE_PADDING_SECONDS * 2;
    if (needed > scene.hold * MAX_HOLD_STRETCH) overruns.push(index);
    return Math.round(Math.max(scene.hold, needed) * 100) / 100;
  });
  return { holds, overruns };
}

/** Where each scene begins once the joins overlap: the holds summed, minus one transition per join. */
export function sceneStarts(holds: number[], transitionSeconds: number): number[] {
  let cursor = 0;
  return holds.map((hold, index) => {
    const start = Math.round(cursor * 1000) / 1000;
    cursor += hold - (index < holds.length - 1 ? transitionSeconds : 0);
    return start;
  });
}
