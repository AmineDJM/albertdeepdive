/**
 * Which language to speak in — decided, never assumed.
 *
 * The rule is that narration follows the publication: a French title is read in French, by a
 * French voice, whatever the interface language of the person who pressed the button. The text
 * itself is the check on that rule: an English piece placed in a French title is read in English,
 * because reading it in a French accent would be wrong in a way nobody would forgive.
 *
 * What this never does is fall back to English because nothing said otherwise. A language it cannot
 * establish is a question for the person, not a default.
 */

export const SPEECH_LANGUAGES = {
  fr: "Français",
  en: "English",
  es: "Español",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  nl: "Nederlands",
} as const;

export type SpeechLanguage = keyof typeof SPEECH_LANGUAGES;

export function isSpeechLanguage(value: string | null | undefined): value is SpeechLanguage {
  return !!value && value in SPEECH_LANGUAGES;
}

/** The base of a locale tag, so "fr-FR" and "en_GB" are recognised. */
export function baseLanguage(value: string | null | undefined): SpeechLanguage | null {
  if (!value) return null;
  const base = value.trim().toLowerCase().split(/[-_]/)[0];
  return isSpeechLanguage(base) ? base : null;
}

/**
 * Function words, which are what tells languages apart in a hundred words.
 *
 * Content words are shared across languages — "innovation", "campus", "data" appear in all seven —
 * and would count for nothing. Articles, prepositions and pronouns are not shared, and each list
 * carries a few spellings the others never use.
 */
const STOPWORDS: Record<SpeechLanguage, string[]> = {
  fr: ["le", "la", "les", "des", "une", "un", "et", "est", "dans", "pour", "que", "qui", "avec", "sur", "pas", "sont", "cette", "nous", "vous", "ils", "elle", "au", "aux", "du", "ce", "ces", "mais", "plus", "leur", "leurs", "été", "ont", "très", "aussi", "comme", "être", "fait", "où", "dont", "chez"],
  en: ["the", "and", "of", "to", "in", "is", "that", "for", "with", "on", "are", "this", "was", "have", "has", "from", "they", "their", "which", "will", "not", "were", "been", "its", "also", "into", "who", "our", "we", "you", "an", "at", "by", "or", "as", "it", "be", "more", "than", "about"],
  es: ["el", "la", "los", "las", "de", "del", "y", "en", "que", "es", "un", "una", "por", "para", "con", "se", "su", "sus", "como", "más", "pero", "son", "fue", "han", "está", "están", "este", "esta", "estos", "también", "muy", "sobre", "entre", "hay", "sin", "ser", "años", "todo", "cuando", "desde"],
  de: ["der", "die", "das", "und", "ist", "in", "den", "von", "zu", "mit", "sich", "des", "auf", "für", "nicht", "ein", "eine", "auch", "es", "an", "als", "wird", "sind", "wurde", "bei", "aus", "nach", "dem", "im", "oder", "haben", "hat", "wir", "sie", "über", "noch", "einer", "einen", "werden", "zum"],
  it: ["il", "la", "di", "che", "e", "è", "un", "una", "per", "con", "non", "del", "della", "dei", "delle", "gli", "le", "sono", "come", "anche", "più", "nel", "nella", "alla", "al", "si", "ha", "hanno", "questo", "questa", "loro", "ma", "tra", "dal", "sul", "essere", "stato", "stata", "molto", "dove"],
  pt: ["o", "a", "os", "as", "de", "da", "do", "das", "dos", "e", "é", "em", "um", "uma", "para", "com", "não", "que", "se", "por", "mais", "como", "foi", "são", "também", "sua", "seu", "seus", "suas", "ao", "à", "está", "este", "esta", "pelo", "pela", "entre", "muito", "já", "ou"],
  nl: ["de", "het", "een", "en", "van", "in", "is", "dat", "op", "te", "zijn", "voor", "met", "die", "niet", "aan", "er", "ook", "als", "bij", "om", "uit", "dan", "maar", "nog", "naar", "door", "over", "wordt", "worden", "heeft", "hebben", "deze", "dit", "we", "ze", "hun", "wat", "meer", "jaar"],
};

/** Letters and marks one language uses and its neighbours mostly do not. Small weight, decisive on short texts. */
const TELLTALES: Record<SpeechLanguage, RegExp> = {
  fr: /[àâçéèêëîïôûùüÿœ]|\b(qu'|d'|l'|n'|c'|j')/i,
  en: /\b(the|and|of)\b/i,
  es: /[ñ¿¡]|ción\b|\bción\b/i,
  de: /[ßäöü]|ung\b|keit\b/i,
  it: /zione\b|\bperché\b|\bgli\b/i,
  pt: /[ãõ]|ção\b|ções\b/i,
  nl: /ij\b|\bhet\b|\been\b/i,
};

export type Detection = { language: SpeechLanguage | null; confidence: number; words: number; scores: Record<SpeechLanguage, number> };

const SETS = Object.fromEntries(Object.entries(STOPWORDS).map(([language, words]) => [language, new Set(words)])) as Record<SpeechLanguage, Set<string>>;

/**
 * How many languages claim a word. "de" belongs to French, Spanish and Portuguese and proves
 * nothing between them; "les" belongs to French alone and proves a great deal. A word's evidence
 * is split between its claimants, so the Romance languages stop looking like each other.
 */
const CLAIMANTS = new Map<string, number>();
for (const words of Object.values(STOPWORDS)) for (const word of words) CLAIMANTS.set(word, (CLAIMANTS.get(word) ?? 0) + 1);

/** A guess and how sure it is, from the words themselves. Ties and thin evidence come back as null. */
export function detectLanguage(text: string): Detection {
  const tokens = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .split(/[^\p{L}']+/u)
    .filter(Boolean);
  const scores = Object.fromEntries(Object.keys(SPEECH_LANGUAGES).map((language) => [language, 0])) as Record<SpeechLanguage, number>;
  for (const token of tokens) {
    const share = 1 / (CLAIMANTS.get(token) ?? 1);
    for (const language of Object.keys(SETS) as SpeechLanguage[]) {
      if (SETS[language].has(token)) scores[language] += share;
    }
  }
  for (const language of Object.keys(TELLTALES) as SpeechLanguage[]) {
    const marks = text.match(new RegExp(TELLTALES[language].source, "giu"))?.length ?? 0;
    scores[language] += Math.min(marks, 6) * 0.5;
  }
  const ranked = (Object.entries(scores) as [SpeechLanguage, number][]).sort((a, b) => b[1] - a[1]);
  const [best, second] = ranked;
  const total = best[1] + (second?.[1] ?? 0);
  if (tokens.length < 4 || best[1] < 2 || total === 0) return { language: null, confidence: 0, words: tokens.length, scores };
  const confidence = best[1] / total;
  return { language: confidence > 0.55 ? best[0] : null, confidence, words: tokens.length, scores };
}

export type LanguageSource = "requested" | "detected" | "article" | "publication" | "workspace";

export type ResolvedLanguage = { language: SpeechLanguage; source: LanguageSource; detection: Detection | null };

export class LanguageUnknownError extends Error {
  constructor() {
    super("Could not tell which language to speak in. Choose one.");
    this.name = "LanguageUnknownError";
  }
}

/** Detection is trusted over the declared language only when it is sure and had enough to go on. */
const CONFIDENT = 0.78;
const ENOUGH_WORDS = 30;

/**
 * Settle the language for one narration.
 *
 * An explicit choice wins. Otherwise the text is read: when it clearly speaks a language, that is
 * the language, whatever the title is declared as — a declared language that disagrees with the
 * words is a mistake in the declaration, not in the words. When the text is too short or too mixed
 * to tell, the article's language, then the publication's, then the workspace's decide. Nothing
 * else does: with none of those, this throws rather than guessing.
 */
export function resolveNarrationLanguage(input: { requested?: string | null; text?: string | null; article?: string | null; publication?: string | null; workspace?: string | null }): ResolvedLanguage {
  const requested = input.requested && input.requested !== "auto" ? baseLanguage(input.requested) : null;
  const detection = input.text ? detectLanguage(input.text) : null;
  if (requested) return { language: requested, source: "requested", detection };

  const declared: [SpeechLanguage | null, LanguageSource][] = [
    [baseLanguage(input.article), "article"],
    [baseLanguage(input.publication), "publication"],
    [baseLanguage(input.workspace), "workspace"],
  ];
  const firstDeclared = declared.find(([language]) => language !== null) ?? null;

  if (detection?.language) {
    const sure = detection.confidence >= CONFIDENT && detection.words >= ENOUGH_WORDS;
    // The words agree with what was declared, or are the only evidence there is, or are sure enough
    // to overrule a declaration they contradict.
    if (!firstDeclared || firstDeclared[0] === detection.language || sure) return { language: detection.language, source: firstDeclared?.[0] === detection.language ? firstDeclared[1] : "detected", detection };
  }
  if (firstDeclared?.[0]) return { language: firstDeclared[0], source: firstDeclared[1], detection };
  if (detection?.language) return { language: detection.language, source: "detected", detection };
  throw new LanguageUnknownError();
}

/** "French", "English" — in the interface's own language, for the screen. */
export const LANGUAGE_NAMES: Record<"en" | "fr", Record<SpeechLanguage, string>> = {
  en: { fr: "French", en: "English", es: "Spanish", de: "German", it: "Italian", pt: "Portuguese", nl: "Dutch" },
  fr: { fr: "Français", en: "Anglais", es: "Espagnol", de: "Allemand", it: "Italien", pt: "Portugais", nl: "Néerlandais" },
};
