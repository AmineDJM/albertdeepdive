import { ValidationError } from "@/lib/action-result";
import { getAiProvider, type AiServiceContext } from "@/server/ai";
import { adaptSpeech } from "@/server/ai/services/speech-adapter";
import { directVoice } from "@/server/ai/services/voice-director";
import { createLogger } from "@/server/logger";
import { LANGUAGE_NAMES, detectLanguage, type SpeechLanguage } from "@/lib/speech/language";
import { decorateWithTags, refineDirection, tagsIn } from "@/lib/speech/direction";
import { normaliseForSpeech, stripTags, type Pronunciation } from "@/lib/speech/script";
import { wordsThatFit } from "@/lib/speech/timing";
import type { Pace, SpeechPassage, VoiceDirection } from "@/lib/speech/types";

const log = createLogger("speech-adapter");

/**
 * The adaptation pass, end to end.
 *
 * A model rewrites the passages for the ear when one is connected; the deterministic rules run
 * either way, after it, so a number or an initialism the model left as written is still said
 * properly. Two things are checked on every answer and never trusted: that one passage came back
 * for each passage sent, and that they came back in the language asked for. An answer that fails
 * either is dropped for that batch and the words stand as written — worse narration, never wrong
 * narration.
 */

export type AdaptScriptInput = {
  passages: SpeechPassage[];
  language: SpeechLanguage;
  /** The language the source is written in, when it differs: the model is asked to translate. */
  sourceLanguage: SpeechLanguage | null;
  mode: "full" | "summary" | "executive";
  pace: Pace;
  direction: VoiceDirection;
  pronunciations: Pronunciation[];
  organizationName: string;
  ctx?: AiServiceContext;
};

export type AdaptedScript = { passages: SpeechPassage[]; source: "model" | "local" };

const BATCH_PASSAGES = 10;
const BATCH_CHARS = 6000;

function batches(passages: SpeechPassage[]): SpeechPassage[][] {
  const out: SpeechPassage[][] = [];
  let current: SpeechPassage[] = [];
  let size = 0;
  for (const passage of passages) {
    if (current.length && (current.length >= BATCH_PASSAGES || size + passage.text.length > BATCH_CHARS)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(passage);
    size += passage.text.length;
  }
  if (current.length) out.push(current);
  return out;
}

export async function adaptScript(input: AdaptScriptInput): Promise<AdaptedScript> {
  const local = getAiProvider().name === "local";
  const translate = input.sourceLanguage !== null && input.sourceLanguage !== input.language;
  if (translate && local) throw new ValidationError("Narrating in another language than the text is written in needs a connected model. Ask your administrator to connect one.");

  const names = LANGUAGE_NAMES.en;
  const adapted = new Map<number, { text: string; tag: string | null }>();
  let usedModel = false;

  for (const batch of batches(input.passages)) {
    const prepared = batch.map((passage) => ({
      index: passage.index,
      speaker: passage.speaker,
      text: passage.text,
      maxWords: passage.maxSeconds ? wordsThatFit(passage.maxSeconds, input.language, input.pace) : null,
    }));
    try {
      const result = await adaptSpeech(
        {
          organizationName: input.organizationName,
          language: input.language,
          languageName: names[input.language],
          sourceLanguageName: translate && input.sourceLanguage ? names[input.sourceLanguage] : null,
          mode: input.mode,
          pronunciations: input.pronunciations.filter((entry) => !entry.language || entry.language === input.language).map((entry) => ({ term: entry.term, say: entry.say })),
          tags: input.direction.tags,
          stance: input.direction.stance,
          passages: prepared,
        },
        { ...input.ctx, cacheable: true },
      );
      const wanted = new Set(batch.map((passage) => passage.index));
      const returned = new Map(result.output.passages.filter((passage) => wanted.has(passage.index)).map((passage) => [passage.index, passage]));
      if (returned.size !== wanted.size) {
        log.warn("adapter answered with the wrong number of passages; keeping the words as written", { wanted: wanted.size, returned: returned.size });
        continue;
      }
      const spoken = [...returned.values()].map((passage) => passage.text).join("\n\n");
      const detected = detectLanguage(spoken);
      if (detected.language && detected.language !== input.language && detected.confidence >= 0.8 && detected.words >= 20) {
        log.warn("adapter answered in the wrong language; keeping the words as written", { asked: input.language, got: detected.language });
        continue;
      }
      for (const [index, passage] of returned) adapted.set(index, { text: passage.text, tag: passage.tag ?? null });
      if (result.provider !== "local") usedModel = true;
    } catch (error) {
      log.warn("adapter failed for a batch; keeping the words as written", { error: error instanceof Error ? error.message : String(error) });
    }
  }

  const passages = input.passages.map((passage) => {
    const answer = adapted.get(passage.index);
    const raw = answer?.text.trim() || passage.text;
    // The model's tag, if it chose one from the palette, travels with the text so the decorator
    // sees it as already placed.
    const chosenTag = answer?.tag && input.direction.tags.includes(answer.tag) ? answer.tag : null;
    const bare = stripTags(raw);
    const text = normaliseForSpeech(bare, input.language, input.pronunciations);
    const withTag = chosenTag ? `${chosenTag} ${text}` : tagsIn(raw).length ? `${tagsIn(raw)[0]} ${text}` : text;
    return { ...passage, text: withTag, plain: stripTags(withTag) };
  });

  const decorated = decorateWithTags(passages, input.direction).map((passage) => ({ ...passage, plain: stripTags(passage.text) }));
  return { passages: decorated, source: usedModel ? "model" : "local" };
}

const CONTEXT_NOTES: Record<VoiceDirection["context"], string> = {
  launch_film: "the voice-over of a short film about a launch: pictures carry half the meaning",
  newsletter: "an edition of a newsletter read aloud, start to finish, to somebody on the move",
  social: "a short social clip, heard once, probably on a phone",
  executive: "a briefing for decision-makers who want the point and the figure",
  community: "a recording for the people the stories are about — students, members, colleagues",
};

/** The base direction, made about this material by a model when one is connected. */
export async function directScript(base: VoiceDirection, input: { organizationName: string; language: SpeechLanguage; tone: string[]; excerpt: string; ctx?: AiServiceContext }): Promise<VoiceDirection> {
  try {
    const result = await directVoice(
      {
        organizationName: input.organizationName,
        context: base.context.replace("_", " "),
        contextNotes: CONTEXT_NOTES[base.context],
        style: base.style,
        pace: base.pace,
        tone: input.tone,
        languageName: LANGUAGE_NAMES.en[input.language],
        tags: base.tags,
        excerpt: input.excerpt.slice(0, 900),
        baseStance: base.stance,
        baseEnergy: base.energy,
        basePauses: base.pauses,
      },
      { ...input.ctx, cacheable: true },
    );
    const refined = refineDirection(base, result.output);
    return result.provider === "local" ? { ...refined, source: "local" } : refined;
  } catch (error) {
    log.warn("director failed; using the base direction", { error: error instanceof Error ? error.message : String(error) });
    return base;
  }
}
