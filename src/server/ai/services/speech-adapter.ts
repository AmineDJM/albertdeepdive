import { z } from "zod";
import { runService, type AiServiceContext } from "./common";

/**
 * The speech adapter: prose into speech, one passage at a time, in the language of the publication.
 *
 * The model decides what to say — how a figure is voiced, where a sentence breaks for breath, what a
 * digest keeps — inside a schema that gives it one passage back per passage in. What it cannot do is
 * change the language, merge two passages or add a fact: the first is checked by the caller against
 * the words themselves, the other two by the shape of the answer.
 */

export const speechAdapterSchema = z.object({
  language: z.string(),
  passages: z.array(z.object({ index: z.number().int(), text: z.string(), tag: z.string().nullable().optional() })),
});
export type SpeechAdapterOutput = z.infer<typeof speechAdapterSchema>;

export type SpeechAdapterInput = {
  organizationName: string;
  language: string;
  languageName: string;
  /** Set when the source is written in another language than the narration: the model translates. */
  sourceLanguageName?: string | null;
  mode: "full" | "summary" | "executive";
  pronunciations: { term: string; say: string }[];
  tags: string[];
  stance: string;
  passages: { index: number; speaker: string; text: string; maxWords: number | null }[];
};

const MODE_RULES = {
  full: "full — keep everything that is said, adapting only how it is said.",
  summary: "digest — condense each passage to its essentials, about a third of its length, keeping the names and the figures that matter.",
  executive: "briefing — state what a decision-maker needs from each passage in a few plain sentences: what happened, the figure, what it means. Calm and concrete.",
} as const;

export async function adaptSpeech(input: SpeechAdapterInput, ctx: AiServiceContext = {}) {
  const passages = input.passages.map((passage) => `#${passage.index} [${passage.speaker}]${passage.maxWords ? ` (at most ${passage.maxWords} words)` : ""}\n${passage.text}`).join("\n\n");
  return runService({
    service: "speech_adapter",
    schemaName: "speech_script",
    schema: speechAdapterSchema,
    tier: "STRONG",
    maxOutputTokens: 6000,
    ctx,
    input: {
      organizationName: input.organizationName,
      language: input.language,
      languageName: input.languageName,
      translationRule: input.sourceLanguageName ? `The source is written in ${input.sourceLanguageName}: translate it faithfully into ${input.languageName}, keeping every proper name as it is.` : "",
      modeRule: MODE_RULES[input.mode],
      pronunciations: input.pronunciations.length ? input.pronunciations.map((entry) => `"${entry.term}" is said "${entry.say}"`).join("; ") : "none",
      tags: input.tags.length ? input.tags.join(" ") : "none — use no tags",
      stance: input.stance,
      passages,
      passagesJson: input.passages,
    },
  });
}
