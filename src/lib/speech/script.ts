import { splitSentences } from "@/lib/editorial/text";
import type { SpeechLanguage } from "./language";
import type { PassageSource, Speaker, SpeechPassage } from "./types";

/**
 * Words on a page, made into words in a mouth.
 *
 * A newsletter is written to be read, and reading aloud what was written to be read produces a
 * recording nobody finishes: "€1.2M" comes out as a shrug, "BDD" as a cough, a URL as a minute of
 * punctuation. The model rewrites the prose for the ear when one is connected; this module is the
 * part that must be right whether or not a model is — the normalisations that are rules rather
 * than judgement, the newsroom's own pronunciations, and the cut into passages a voice can perform.
 *
 * Every function is pure and the language is a parameter, never an assumption.
 */

export type Pronunciation = { term: string; say: string; language?: string | null };

/** What an audio tag looks like on the page: a short bracketed word or two, nothing nested. */
const TAG = /\[[a-zA-Z][a-zA-Z ]{1,24}\]/g;

export function stripTags(text: string): string {
  return text.replace(TAG, "").replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").trim();
}

export function countWords(text: string): number {
  const plain = stripTags(text).trim();
  return plain ? plain.split(/\s+/).length : 0;
}

/* ── Spoken forms ─────────────────────────────────────────────────────────────────────────── */

type Words = {
  percent: string;
  euros: string;
  dollars: string;
  pounds: string;
  million: string;
  billion: string;
  thousand: string;
  times: string;
  and: string;
  moreThan: string;
  to: string;
  number: string;
  dot: string;
  at: string;
  forExample: string;
  thatIs: string;
  etCetera: string;
  versus: string;
  decimal: string;
};

const WORDS: Record<SpeechLanguage, Words> = {
  en: { percent: "percent", euros: "euros", dollars: "dollars", pounds: "pounds", million: "million", billion: "billion", thousand: "thousand", times: "times", and: "and", moreThan: "more than", to: "to", number: "number", dot: "dot", at: "at", forExample: "for example", thatIs: "that is", etCetera: "and so on", versus: "versus", decimal: "." },
  fr: { percent: "pour cent", euros: "euros", dollars: "dollars", pounds: "livres", million: "millions", billion: "milliards", thousand: "mille", times: "fois", and: "et", moreThan: "plus de", to: "à", number: "numéro", dot: "point", at: "arobase", forExample: "par exemple", thatIs: "c'est-à-dire", etCetera: "et cetera", versus: "contre", decimal: "," },
  es: { percent: "por ciento", euros: "euros", dollars: "dólares", pounds: "libras", million: "millones", billion: "mil millones", thousand: "mil", times: "veces", and: "y", moreThan: "más de", to: "a", number: "número", dot: "punto", at: "arroba", forExample: "por ejemplo", thatIs: "es decir", etCetera: "etcétera", versus: "contra", decimal: "," },
  de: { percent: "Prozent", euros: "Euro", dollars: "Dollar", pounds: "Pfund", million: "Millionen", billion: "Milliarden", thousand: "tausend", times: "mal", and: "und", moreThan: "mehr als", to: "bis", number: "Nummer", dot: "Punkt", at: "at", forExample: "zum Beispiel", thatIs: "das heißt", etCetera: "und so weiter", versus: "gegen", decimal: "," },
  it: { percent: "per cento", euros: "euro", dollars: "dollari", pounds: "sterline", million: "milioni", billion: "miliardi", thousand: "mila", times: "volte", and: "e", moreThan: "più di", to: "a", number: "numero", dot: "punto", at: "chiocciola", forExample: "per esempio", thatIs: "cioè", etCetera: "eccetera", versus: "contro", decimal: "," },
  pt: { percent: "por cento", euros: "euros", dollars: "dólares", pounds: "libras", million: "milhões", billion: "mil milhões", thousand: "mil", times: "vezes", and: "e", moreThan: "mais de", to: "a", number: "número", dot: "ponto", at: "arroba", forExample: "por exemplo", thatIs: "ou seja", etCetera: "etcétera", versus: "contra", decimal: "," },
  nl: { percent: "procent", euros: "euro", dollars: "dollar", pounds: "pond", million: "miljoen", billion: "miljard", thousand: "duizend", times: "keer", and: "en", moreThan: "meer dan", to: "tot", number: "nummer", dot: "punt", at: "apenstaartje", forExample: "bijvoorbeeld", thatIs: "dat wil zeggen", etCetera: "enzovoort", versus: "tegen", decimal: "," },
};

/**
 * Initialisms read letter by letter, whatever the vowels say.
 *
 * "NASA" is a word and "CEO" is three letters, and no rule of spelling tells them apart — so the
 * common ones are listed. Anything else in capitals is spelled out when it has no vowel to be
 * pronounced with, and left alone when it does. A newsroom's own dictionary overrides all of it.
 */
const SPELLED = new Set([
  "AI", "IA", "IT", "HR", "RH", "PR", "RP", "CEO", "CFO", "CTO", "COO", "CMO", "PDG", "DG", "DRH", "ESG", "RSE", "CSR", "ONG", "NGO", "USA", "UK", "EU", "UE", "UN", "ONU", "BDD", "KPI", "CRM", "ERP", "API", "URL", "PDF", "MBA", "BBA", "MSC", "BSC", "CV", "UX", "UI", "IOT", "ML", "LLM", "VC", "IPO", "ROI", "SEO", "SEA", "B2B", "B2C", "PHD", "HEC", "ENS", "CNRS", "CDI", "CDD", "TVA", "VAT", "PME", "SME", "ETI", "TPE", "SA", "SAS", "SARL", "LTD", "GDPR", "RGPD", "CAC", "ETF", "R&D", "M&A", "Q&A", "FAQ", "TV", "DJ", "OK", "PC", "CPU", "GPU", "SQL", "HTML", "CSS", "JS", "OS", "USB", "ADN", "DNA", "IRM", "MRI", "VP", "SVP", "EVP", "HQ", "BTS", "DUT", "BUT", "IUT", "ESSEC", "EDHEC", "INSEAD",
]);
/** Capitalised words that are said as words and must not be spelled. */
const SAID_AS_WORDS = new Set(["NASA", "UNESCO", "UNICEF", "OTAN", "NATO", "ERASMUS", "COVID", "SAAS", "FINTECH", "EDTECH", "LEGO", "IKEA", "ESSEC", "EDHEC", "INSEAD", "SCIENCESPO", "CAPGEMINI", "OCDE", "OECD", "NIKE", "ADIDAS", "FIFA", "UEFA", "AMAZON", "GOOGLE", "TESLA", "NETFLIX", "SPOTIFY", "ZARA", "LVMH"]);

function spell(acronym: string): string {
  return acronym
    .replace(/&/g, "")
    .split("")
    .filter((letter) => /[A-Z0-9]/.test(letter))
    .join(". ")
    .concat(".");
}

/** Whether a run of capitals is read as letters. Listed words win; otherwise two letters always, three to five only without a vowel. */
export function isSpelledAcronym(token: string): boolean {
  const upper = token.toUpperCase();
  if (SAID_AS_WORDS.has(upper) && !SPELLED.has(upper)) return false;
  if (SPELLED.has(upper)) return true;
  if (!/^[A-Z][A-Z0-9&]{1,4}$/.test(token)) return false;
  if (token.length === 2) return true;
  return !/[AEIOUY]/.test(token);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The newsroom's own pronunciations, longest term first so "Albert School" is matched before "Albert". */
export function applyPronunciations(text: string, entries: Pronunciation[], language: SpeechLanguage): string {
  const applicable = entries
    .filter((entry) => entry.term.trim() && entry.say.trim() && (!entry.language || entry.language === language))
    .sort((a, b) => b.term.length - a.term.length);
  let out = text;
  for (const entry of applicable) {
    const term = escapeRegExp(entry.term.trim());
    // Word boundaries that understand accents: a lookaround on letters rather than \b, which
    // treats "é" as a boundary and would match "Sté" inside "Stéphane".
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${term}(?![\\p{L}\\p{N}])`, "giu"), entry.say.trim());
  }
  return out;
}

function money(amount: string, unit: string | undefined, currency: string, words: Words): string {
  const scale = unit ? { k: words.thousand, m: words.million, bn: words.billion, b: words.billion, md: words.billion, mds: words.billion }[unit.toLowerCase()] : null;
  const number = amount.replace(/\s/g, "");
  return scale ? `${number} ${scale} ${currency}` : `${number} ${currency}`;
}

/**
 * The normalisations that are rules.
 *
 * Symbols, currencies, ranges, addresses and initialisms, in the language's own words. Conservative
 * on purpose: a rule that rewrites something it does not understand does more harm than a model
 * that leaves it, so each pattern is narrow and anything it does not match passes through untouched.
 */
export function normaliseForSpeech(input: string, language: SpeechLanguage, pronunciations: Pronunciation[] = []): string {
  const w = WORDS[language];
  let text = input
    .replace(/\r/g, "")
    // Markdown and typographic noise that would be read as punctuation.
    .replace(/[*_`#>]+/g, " ")
    .replace(/\s*\|\s*/g, ", ")
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/ /g, " ");

  text = applyPronunciations(text, pronunciations, language);

  // Addresses: read the domain, drop the plumbing.
  // The path is dropped and the sentence's own full stop is kept: "at acme.com/news." ends in a period.
  text = text.replace(/https?:\/\/(?:www\.)?([a-z0-9.-]+\.[a-z]{2,})(?:\/[^\s)]*?)?(?=[.,;:!?)]*(?:\s|$))/gi, (_, domain: string) => domain.replace(/\./g, ` ${w.dot} `));
  text = text.replace(/\bwww\.([a-z0-9.-]+\.[a-z]{2,})/gi, (_, domain: string) => domain.replace(/\./g, ` ${w.dot} `));
  text = text.replace(/\b([a-z0-9._-]+)@([a-z0-9.-]+\.[a-z]{2,})\b/gi, (_, user: string, domain: string) => `${user.replace(/\./g, ` ${w.dot} `)} ${w.at} ${domain.replace(/\./g, ` ${w.dot} `)}`);

  // Money: "€1.2M", "1,2 M€", "$40k", "£3bn".
  text = text.replace(/([€$£])\s?(\d(?:[\d\s.,]*\d)?)\s?(k|K|m|M|bn|Bn|BN|b|B|Md|Mds)?(?![\p{L}\p{N}])/gu, (_, symbol: string, amount: string, unit?: string) => {
    const currency = symbol === "€" ? w.euros : symbol === "$" ? w.dollars : w.pounds;
    return money(amount.trim(), unit, currency, w);
  });
  text = text.replace(/(\d(?:[\d\s.,]*\d)?)\s?(k|K|M|Md|Mds|bn|Bn)?\s?([€$£])/gu, (_, amount: string, unit: string | undefined, symbol: string) => {
    const currency = symbol === "€" ? w.euros : symbol === "$" ? w.dollars : w.pounds;
    return money(amount.trim(), unit, currency, w);
  });

  // Percentages, multiples, counts with a plus, ranges, issue numbers.
  text = text.replace(/(\d[\d.,]*)\s?%/g, `$1 ${w.percent}`);
  text = text.replace(/(\d[\d.,]*)\s?[x×]\b/g, `$1 ${w.times}`);
  text = text.replace(/(\d[\d.,]*)\s?\+(?!\d)/g, `${w.moreThan} $1`);
  text = text.replace(/(\d{4})\s?[–—-]\s?(\d{4})/g, `$1 ${w.to} $2`);
  text = text.replace(/(\d+)\s?[–—-]\s?(\d+)\s?(h|%|${w.percent})/g, `$1 ${w.to} $2 $3`);
  text = text.replace(/\b[Nn]°\s?(\d+)/g, `${w.number} $1`);
  text = text.replace(/\bn[°º]\s?(\d+)/g, `${w.number} $1`);
  text = text.replace(/\s&\s/g, ` ${w.and} `);
  text = text.replace(/\b(e\.g\.|eg\.)\s/gi, `${w.forExample} `);
  text = text.replace(/\b(i\.e\.)\s/gi, `${w.thatIs} `);
  text = text.replace(/\betc\.?(?=[\s.,;)]|$)/gi, w.etCetera);
  text = text.replace(/\bvs\.?\s/gi, `${w.versus} `);

  // Initialisms, letter by letter. Tokens the dictionary rewrote are already gone.
  text = text.replace(/(?<![\p{L}\p{N}.-])([A-Z][A-Z0-9&]{1,4})(?![\p{L}\p{N}])/gu, (token: string) => (isSpelledAcronym(token) ? spell(token) : token));

  // Dashes read as pauses rather than as "hyphen"; then tidy.
  text = text.replace(/\s+[–—]\s+/g, ", ");
  text = text.replace(/[ \t]{2,}/g, " ").replace(/ +([,.;:!?])/g, "$1").replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

/* ── Passages ─────────────────────────────────────────────────────────────────────────────── */

/** What the source hands the script builder: a unit of prose with what it is and where it sits. */
export type SourceBlock = {
  kind: "heading" | "paragraph" | "quote" | "qa" | "aside" | "scene" | "custom";
  text: string;
  /** For a quotation or an answer: who said it, so a second voice can take it. */
  speaker?: string | null;
  attribution?: string | null;
  sourceId?: string | null;
  chapter?: string | null;
  sceneIndex?: number | null;
  maxSeconds?: number | null;
};

/** A provider's comfortable request; well under the hard ceilings so a long sentence never trips one. */
export const MAX_PASSAGE_CHARS = 2400;

/** Cut a run of prose at sentence ends only, into pieces no longer than `maxChars`. */
export function splitAtSentences(text: string, maxChars = MAX_PASSAGE_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of splitSentences(clean)) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) pieces.push(current);
    if (sentence.length <= maxChars) {
      current = sentence;
      continue;
    }
    // A sentence longer than a passage: cut at clause boundaries, and as a last resort at spaces.
    let rest = sentence;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cut = Math.max(window.lastIndexOf("; "), window.lastIndexOf(", "), window.lastIndexOf(" "));
      const at = cut > maxChars / 3 ? cut + 1 : maxChars;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    current = rest;
  }
  if (current) pieces.push(current);
  return pieces;
}

const SOURCE_FOR: Record<SourceBlock["kind"], PassageSource> = { heading: "headline", paragraph: "body", quote: "quote", qa: "qa", aside: "aside", scene: "scene", custom: "custom" };

/**
 * Blocks into passages.
 *
 * Consecutive body paragraphs of one chapter are joined into passages up to the limit, so the voice
 * carries a thought across paragraph breaks instead of restarting at each. A heading, a quotation,
 * a question-and-answer, a scene each stand alone: they are performed differently, and a second
 * voice may take a quotation when the person allowed it.
 */
export function passagesFrom(blocks: SourceBlock[], options: { maxChars?: number; secondVoice?: boolean } = {}): SpeechPassage[] {
  const maxChars = options.maxChars ?? MAX_PASSAGE_CHARS;
  const passages: SpeechPassage[] = [];
  let run: SourceBlock[] = [];

  const flush = () => {
    if (!run.length) return;
    const first = run[0];
    const joined = run.map((block) => block.text.trim()).filter(Boolean).join("\n\n");
    for (const piece of splitAtSentences(joined, maxChars)) {
      passages.push({ index: passages.length, speaker: "narrator", text: piece, plain: stripTags(piece), sourceType: "body", sourceId: first.sourceId ?? null, chapter: first.chapter ?? null, sceneIndex: null, maxSeconds: null });
    }
    run = [];
  };

  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;
    const sameRun = block.kind === "paragraph" && run.length && run[0].chapter === block.chapter && run[0].sourceId === block.sourceId;
    if (block.kind === "paragraph") {
      if (!sameRun) flush();
      // Keep a run together only while a fresh paragraph still fits alongside it.
      if (run.length && run.reduce((n, b) => n + b.text.length + 2, 0) + text.length > maxChars) flush();
      run.push(block);
      continue;
    }
    flush();
    const speaker: Speaker = options.secondVoice && (block.kind === "quote" || block.kind === "qa") && block.speaker ? "second" : "narrator";
    for (const piece of splitAtSentences(text, maxChars)) {
      passages.push({
        index: passages.length,
        speaker,
        text: piece,
        plain: stripTags(piece),
        sourceType: SOURCE_FOR[block.kind],
        sourceId: block.sourceId ?? null,
        chapter: block.chapter ?? null,
        sceneIndex: block.sceneIndex ?? null,
        maxSeconds: block.maxSeconds ?? null,
      });
    }
  }
  flush();
  return passages;
}

export function scriptTotals(passages: SpeechPassage[]): { words: number; characters: number } {
  return passages.reduce((totals, passage) => ({ words: totals.words + countWords(passage.text), characters: totals.characters + passage.text.length }), { words: 0, characters: 0 });
}
