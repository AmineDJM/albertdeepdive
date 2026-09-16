/**
 * Pure text utilities shared by the deterministic local AI provider, the clustering engine and the
 * editorial checks. Everything here is rule-based and side-effect free: no model, no database.
 * Nothing in this module ever invents content — every output is a substring or a re-arrangement of
 * its input.
 */

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const MONTH_ALIASES: Record<string, number> = {};
MONTHS.forEach((m, i) => {
  MONTH_ALIASES[m.toLowerCase()] = i + 1;
  MONTH_ALIASES[m.slice(0, 3).toLowerCase()] = i + 1;
});
MONTH_ALIASES.sept = 9;

const MONTH_RE = "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)";
const DAY_RE = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";
const DAY_NAMES = new Set(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

export const STOPWORDS = new Set(
  `a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those
   there their they them he she his her we our us you your i me my mine not no nor so than then too very can could
   will would shall should may might must do does did done have has had having into onto over under about after before
   between during through while where when who whom whose which what why how all any both each few more most other some
   such only own same also just here now out up down off again further once s t d ll re ve m
   le la les un une des du de et en au aux pour par sur dans avec sans est sont ce cette ces qui que quoi dont ou où ne pas
   plus moins très nous vous ils elles il elle je tu mon ma mes ton ta tes son sa ses leur leurs notre nos votre vos`
    .split(/\s+/)
    .filter(Boolean),
);

/** Capitalised words that are never (on their own) a person's name. */
export const COMMON_CAPITALISED = new Set(
  `the a an and or but of to in on at by for with from as is are was were be it its this that these those there their
   they them he she his her we our us you your i me my not no so than then too very can could will would shall should
   may might must do does did done have has had having into onto over under about after before between during through
   while where when who whom whose which what why how all any both each few more most other some such only own same also
   just here now out up down off again further once
   business deep dive dives data science school master masters bachelor bachelors students student party run day week
   month year new first second third special issue photo photos edition team teams jury winners winner winning final
   finals finalists group groups case study project projects company companies event events campus campuses association
   associations club clubs interview profile news actus story stories article articles anecdote anecdotes life
   ai ml it hr pr ceo cio cto coo cfo msc mba bba b1 b2 b3 m1 m2
   monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september
   october november december fun fact congratulations well thanks thank welcome hello hi see sign join follow find read
   pet food hyper market thanks special mention big shop shops sales model models dashboard dashboards french france
   european europe english international national global true false yes no deep dive`
    .split(/\s+/)
    .filter(Boolean),
);

export const ORG_KEYWORDS = [
  "school",
  "école",
  "ecole",
  "university",
  "université",
  "institute",
  "institut",
  "group",
  "groupe",
  "ministry",
  "ministère",
  "software",
  "bank",
  "banque",
  "sas",
  "sa",
  "inc",
  "ltd",
  "llc",
  "gmbh",
  "corp",
  "corporation",
  "company",
  "compagnie",
  "association",
  "foundation",
  "fondation",
  "agency",
  "agence",
  "events",
  "media",
  "press",
  "tribune",
  "journal",
  "times",
  "bds",
  "bde",
  "crew",
  "club",
  "consulting",
  "partners",
  "capital",
  "ventures",
  "labs",
  "studio",
  "technologies",
  "systems",
  "solutions",
  "holdings",
  "retail",
  "trucks",
  "airlines",
  "energy",
  "mind",
  "psl",
  "hec",
  "escp",
  "edhec",
  "insee",
  "polytechnique",
];

export const PLACE_KEYWORDS = ["stade", "stadium", "rue", "avenue", "boulevard", "place", "campus", "bay", "station", "hall", "palais", "parc", "park", "square", "quai", "bay", "tower", "centre", "center", "arena", "hôtel", "hotel", "gare", "aéroport", "airport", "île", "island"];

export const CITY_NAMES = new Set(["paris", "lyon", "marseille", "geneva", "genève", "geneve", "london", "berlin", "madrid", "rome", "brussels", "amsterdam", "lausanne", "zurich", "nice", "bordeaux", "toulouse", "lille", "nantes", "montpellier", "strasbourg", "korea", "seoul", "france", "switzerland", "europe", "china", "usa", "america"]);

const TYPO_MAP: Record<string, string> = {
  teh: "the",
  recieve: "receive",
  recieved: "received",
  occured: "occurred",
  seperate: "separate",
  definately: "definitely",
  wich: "which",
  adress: "address",
  untill: "until",
  acheive: "achieve",
  acheived: "achieved",
  begining: "beginning",
  comming: "coming",
  enviroment: "environment",
  goverment: "government",
  independant: "independent",
  occassion: "occasion",
  succesful: "successful",
  tommorow: "tomorrow",
  truely: "truly",
  wierd: "weird",
};

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cleans layout noise and obvious typos without touching names, numbers or quotations:
 * collapses whitespace, fixes spacing around punctuation, de-duplicates terminal punctuation and
 * applies a tiny dictionary of unambiguous misspellings (case preserved).
 */
export function cleanText(text: string): string {
  let out = normalizeWhitespace(text);
  out = out.replace(/ +([,;:!?.])/g, "$1");
  out = out.replace(/([,;:])(?=[^\s\d"”’'\/])/g, "$1 ");
  out = out.replace(/([.!?])(?=[A-Z][a-z])/g, "$1 ");
  out = out.replace(/([!?]){2,}/g, "$1");
  out = out.replace(/\.{4,}/g, "…");
  out = out.replace(/\.{3}/g, "…");
  out = out.replace(/\b([A-Za-z]+)\b/g, (word) => {
    const lower = word.toLowerCase();
    const fix = TYPO_MAP[lower];
    if (!fix) return word;
    if (word === lower) return fix;
    if (word === word.toUpperCase()) return fix.toUpperCase();
    return fix[0].toUpperCase() + fix.slice(1);
  });
  return out.trim();
}

export function splitParagraphs(text: string): string[] {
  return normalizeWhitespace(text)
    .split(/\n\s*\n|\n(?=[A-Z“"])/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const ABBREVIATIONS = /\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|e\.g|i\.e|No|Inc|Ltd|Jr|Sr|Mme|M|B\d|M\d|p)\.$/i;

/** Sentence splitter tolerant of abbreviations, decimals ("0.4%"), initials and quotation marks. */
export function splitSentences(text: string): string[] {
  const normalized = normalizeWhitespace(text).replace(/\n+/g, " ");
  const out: string[] = [];
  let current = "";
  const chars = [...normalized];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    current += ch;
    if (ch === "." || ch === "!" || ch === "?" || ch === "…") {
      const next = chars[i + 1];
      const nextNext = chars[i + 2];
      if (ch === "." && next !== undefined && /\d/.test(next) && /\d/.test(current[current.length - 2] ?? "")) continue;
      if (ch === "." && ABBREVIATIONS.test(current.trim())) continue;
      let closing = "";
      let j = i + 1;
      while (j < chars.length && /["”’')\]]/.test(chars[j])) {
        closing += chars[j];
        j += 1;
      }
      const after = chars[j];
      if (after !== undefined && after !== " " && after !== "\n") continue;
      const following = chars[j + 1] ?? nextNext;
      if (after === " " && following !== undefined && /[a-z]/.test(following) && ch === "." && !closing) continue;
      current += closing;
      i = j - 1;
      const trimmed = current.trim();
      if (trimmed) out.push(trimmed);
      current = "";
    }
  }
  const rest = current.trim();
  if (rest) out.push(rest);
  return out;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[a-z0-9][a-z0-9'’\-]*/g) ?? []).map((t) => t.replace(/^[’'\-]+|[’'\-]+$/g, "")).filter((t) => t.length > 1);
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

export function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text.trim();
  return words.slice(0, maxWords).join(" ").replace(/[,;:\-–—]+$/, "") + "…";
}

/** Truncates at a word boundary, ending with an ellipsis when cut. */
export function truncateChars(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, Math.max(1, maxChars - 1));
  const boundary = cut.lastIndexOf(" ");
  const base = boundary > maxChars * 0.5 ? cut.slice(0, boundary) : cut;
  return base.replace(/[,;:\-–—.]+$/, "") + "…";
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function stripDiacritics(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Canonical form for matching names: no diacritics, lowercase, single spaces, no punctuation. */
export function normalizeName(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when two names are almost certainly the same person spelled differently: same first letter,
 * comparable length, edit distance 1–2 (case-insensitive, diacritic-sensitive so "Jaskulke" vs
 * "Jaskulké" is flagged) and not identical.
 */
export function nearIdenticalNames(a: string, b: string): boolean {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) return false;
  if (x.length < 5 || y.length < 5) return false;
  if (Math.abs(x.length - y.length) > 2) return false;
  if (x[0] !== y[0]) return false;
  const d = levenshtein(x, y);
  return d >= 1 && d <= 2;
}

/** Same as nearIdenticalNames but tolerant to diacritics/case (used for fuzzy entity matching). */
export function sameNameLoose(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length < 6 || y.length < 6) return false;
  if (Math.abs(x.length - y.length) > 2) return false;
  return levenshtein(x, y) <= 2;
}

const NAME_WORD = "(?:[dDlL][’'])?\\p{Lu}[\\p{L}\\p{M}’'\\-]*";
const CONNECTOR = "(?:de|du|des|la|le|van|von|of|da|di|del|&|d’|l’|d'|l')";
/**
 * Horizontal whitespace only: a name never spans a line break, so "Company: Carrefour\nCohort: B2"
 * must not be read as the person "Carrefour Cohort".
 */
const NAME_GAP = "[^\\S\\r\\n]+";
const NAME_SEQUENCE = new RegExp(`${NAME_WORD}(?:${NAME_GAP}(?:${CONNECTOR}${NAME_GAP})?${NAME_WORD})+`, "gu");
const SINGLE_CAP = new RegExp(`(?<![\\p{L}’'])${NAME_WORD}(?![\\p{L}’'])`, "gu");

export type NameCandidate = { name: string; index: number; words: string[] };

function nameWords(name: string): string[] {
  return name.split(/\s+/).filter(Boolean);
}

function isCommonWord(word: string): boolean {
  const w = stripDiacritics(word.replace(/^[dl][’']/i, "")).toLowerCase().replace(/[’'\-]/g, "");
  return COMMON_CAPITALISED.has(w) || DAY_NAMES.has(w) || w in MONTH_ALIASES;
}

function isAcronym(word: string): boolean {
  return word.length > 1 && word === word.toUpperCase() && /^[\p{Lu}]+$/u.test(word);
}

/**
 * Extracts capitalised multi-word sequences ("Enzo Natali", "Victor de l'Epine", "Institut Curie").
 * Sequences whose words are all common capitalised words or all-caps headings are ignored.
 */
export function extractNameCandidates(text: string): NameCandidate[] {
  const out: NameCandidate[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(NAME_SEQUENCE)) {
    const raw = match[0].replace(/[,.;:!?]+$/, "");
    const words = nameWords(raw);
    if (words.length < 2 || words.length > 5) continue;
    const significant = words.filter((w) => !new RegExp(`^${CONNECTOR}$`, "i").test(w));
    if (significant.every((w) => isAcronym(w) && w.length > 3)) continue; // shouting crosshead
    if (significant.every(isCommonWord)) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: raw, index: match.index ?? 0, words });
  }
  return out;
}

export function containsOrgKeyword(name: string): boolean {
  const words = nameWords(stripDiacritics(name).toLowerCase().replace(/[^a-z0-9& ]/g, " "));
  return words.some((w) => ORG_KEYWORDS.includes(w)) || /\b[A-Z]{2,5}\b/.test(name);
}

export function containsPlaceKeyword(name: string): boolean {
  const words = nameWords(stripDiacritics(name).toLowerCase());
  return words.some((w) => PLACE_KEYWORDS.includes(w)) || words.some((w) => CITY_NAMES.has(w));
}

export function looksLikePersonName(name: string): boolean {
  const words = nameWords(name);
  const significant = words.filter((w) => !new RegExp(`^${CONNECTOR}$`, "i").test(w));
  if (significant.length < 2 || significant.length > 4) return false;
  if (significant.some((w) => isCommonWord(w))) return false;
  if (significant.some((w) => isAcronym(w) && w.length > 2)) return false;
  if (containsOrgKeyword(name) || containsPlaceKeyword(name)) return false;
  if (/\d/.test(name)) return false;
  return true;
}

export type ExtractedEntities = {
  people: { name: string; role: string }[];
  organisations: { name: string; type: string }[];
  places: string[];
};

function organisationType(name: string): string {
  const n = stripDiacritics(name).toLowerCase();
  if (/\b(association|bds|bde|crew|club)\b/.test(n)) return "ASSOCIATION";
  if (/\b(school|ecole|university|universite|polytechnique|hec|escp|edhec|psl|mines)\b/.test(n)) return "SCHOOL";
  if (/\b(institut|institute|ministry|ministere|insee|foundation|fondation|commission|government)\b/.test(n)) return "INSTITUTION";
  if (/\b(tribune|journal|times|media|press|magazine|radio|tv)\b/.test(n)) return "MEDIA";
  if (/\b(startup|start-up|labs|studio)\b/.test(n)) return "STARTUP";
  return "COMPANY";
}

type RoleRule = { role: string; re: RegExp };
const ROLE_RULES: RoleRule[] = [
  { role: "JURY", re: /\b(members? of the jury|jury members?|on the jury|the jury was|jury\s*:|jurors?|judges?)\b/i },
  { role: "WINNER", re: /\b(won|winners?|winning team|first place|champions?|favourites?|favorites?)\b/i },
  { role: "FINALIST", re: /\b(finalists?|runners?-up|final four|top \d)\b/i },
  { role: "FOUNDER", re: /\b(founded|founder|co-?founded|co-?founder|president|set up the)\b/i },
  { role: "ORGANISER", re: /\b(organis(?:ed|er|ers)|organiz(?:ed|er|ers)|orchestrated)\b/i },
  { role: "INTERVIEWEE", re: /\b(interview(?:ed)?|tells us|introduce yourself|my name is)\b/i },
  { role: "AUTHOR", re: /\b(article by|written by|photos? by|author)\b/i },
  { role: "JURY", re: /\bjury\b(?!['’]s)/i },
];

/** Labelled lines produced by the normaliser ("Winning team: A, B") give exact roles. */
const LABEL_ROLES: { re: RegExp; role: string }[] = [
  { re: /^(?:winning team|winners?)\s*:/i, role: "WINNER" },
  { re: /^jury\s*:/i, role: "JURY" },
  { re: /^finalists?\s*:/i, role: "FINALIST" },
  { re: /^organis(?:er|ers|ed by)\s*:/i, role: "ORGANISER" },
  { re: /^(?:founders?|president)\s*:/i, role: "FOUNDER" },
  { re: /^(?:interviewee|interview with)\s*:/i, role: "INTERVIEWEE" },
  { re: /^(?:photos?|photographer|article|author)\s*:/i, role: "AUTHOR" },
];

/**
 * Rule-based entity extraction. People = capitalised multi-word names; organisations = names with an
 * organisation keyword, acronyms, or the caller-provided list; places = names with a place keyword.
 * Roles are read from the surrounding sentence (jury / won / founded / organised...).
 */
export function extractEntities(text: string, knownOrganisations: string[] = []): ExtractedEntities {
  const people = new Map<string, { name: string; role: string }>();
  const organisations = new Map<string, { name: string; type: string }>();
  const places = new Set<string>();
  const known = knownOrganisations.map((o) => o.trim()).filter((o) => o.length > 1);
  let masked = text;
  for (const org of [...known].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(org.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    if (re.test(masked)) {
      organisations.set(normalizeName(org), { name: org, type: organisationType(org) });
      masked = masked.replace(re, " ");
    }
  }

  const lines = masked.split(/\n+/);
  for (const line of lines) {
    const label = LABEL_ROLES.find((l) => l.re.test(line.trim()));
    const segments = line.split(/;/);
    for (const segment of segments) {
      const segLabel = LABEL_ROLES.find((l) => l.re.test(segment.trim())) ?? label;
      const sentenceRole = segLabel?.role ?? null;
      for (const sentence of splitSentences(segment)) {
        const candidates = extractNameCandidates(sentence);
        const ruleRole = sentenceRole ?? ROLE_RULES.find((r) => r.re.test(sentence))?.role ?? "MENTIONED";
        for (const c of candidates) {
          if (containsPlaceKeyword(c.name) && !containsOrgKeyword(c.name)) {
            places.add(c.name);
            continue;
          }
          if (containsOrgKeyword(c.name)) {
            const key = normalizeName(c.name);
            if (!organisations.has(key)) organisations.set(key, { name: c.name, type: organisationType(c.name) });
            continue;
          }
          if (looksLikePersonName(c.name)) {
            const key = normalizeName(c.name);
            const existing = people.get(key);
            if (!existing) people.set(key, { name: c.name, role: ruleRole });
            else if (existing.role === "MENTIONED" && ruleRole !== "MENTIONED") existing.role = ruleRole;
          }
        }
      }
    }
  }

  // Single capitalised words used at least twice, not at sentence start → organisation candidates.
  const counts = new Map<string, number>();
  const starts = new Set<string>();
  for (const sentence of splitSentences(masked)) {
    const first = sentence.match(/^[“"]?([\p{L}’'\-]+)/u)?.[1];
    if (first) starts.add(first);
    for (const m of sentence.matchAll(SINGLE_CAP)) {
      const w = m[0].replace(/[’']s$/, "");
      if (w.length < 3 || isCommonWord(w) || CITY_NAMES.has(w.toLowerCase())) continue;
      const before = sentence.slice(Math.max(0, (m.index ?? 0) - 30), m.index ?? 0);
      const after = sentence.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 30);
      const orgContext =
        /\b(?:at|with|by|for|to|from|of|the|retailer|company|partner|sponsor|thanks to|joined|join|behind)\s*$/i.test(before) ||
        /^(?:['’]s|\s+(?:jury|shops?|stores?|team|final|bdd|business|group|headquarters|campus|office|prize|case|challenge|project|dashboard))\b/i.test(after);
      if (!orgContext) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const personWords = new Set([...people.values()].flatMap((p) => p.name.split(/\s+/)));
  for (const [word, n] of counts) {
    if (n < 2 || personWords.has(word)) continue;
    const key = normalizeName(word);
    if (organisations.has(key)) continue;
    if ([...organisations.keys()].some((k) => k.split(" ").includes(key))) continue;
    if ([...people.keys()].some((k) => k.split(" ").includes(key))) continue;
    organisations.set(key, { name: word, type: isAcronym(word) ? "INSTITUTION" : "COMPANY" });
  }
  for (const m of masked.matchAll(/\b(?:in|at|to|from)\s+(Paris|Lyon|Marseille|Geneva|Genève|Saint-Tropez|London|Berlin)\b/g)) places.add(m[1]);

  return { people: [...people.values()], organisations: [...organisations.values()], places: [...places] };
}

export type ExtractedDate = { text: string; iso: string | null };

function toIso(year: number, month: number, day: number): string | null {
  if (!month || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Dates as written ("17 March", "Friday 4th April 2025", "April 2025", "2025-04-04"). */
export function extractDates(text: string): ExtractedDate[] {
  const out: ExtractedDate[] = [];
  const seen = new Set<string>();
  const push = (raw: string, iso: string | null) => {
    const t = raw.trim().replace(/,$/, "");
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ text: t, iso });
  };
  const dmy = new RegExp(`(?:${DAY_RE},?\\s+)?\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})\\b(?:\\s+(\\d{4}))?`, "g");
  for (const m of text.matchAll(dmy)) {
    const year = m[3] ? Number(m[3]) : null;
    push(m[0], year ? toIso(year, MONTH_ALIASES[m[2].toLowerCase()] ?? 0, Number(m[1])) : null);
  }
  const mdy = new RegExp(`\\b(${MONTH_RE})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "g");
  for (const m of text.matchAll(mdy)) {
    if (m[2].length === 4) continue; // "April 2025" handled below
    const year = m[3] ? Number(m[3]) : null;
    push(m[0], year ? toIso(year, MONTH_ALIASES[m[1].toLowerCase()] ?? 0, Number(m[2])) : null);
  }
  const my = new RegExp(`\\b(${MONTH_RE})\\s+(\\d{4})\\b`, "g");
  for (const m of text.matchAll(my)) push(m[0], null);
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m[0], toIso(Number(m[1]), Number(m[2]), Number(m[3])));
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) push(m[0], toIso(Number(m[3]), Number(m[2]), Number(m[1])));
  return out;
}

export type ExtractedMetric = { label: string; value: string };

const UNIT_RE = "(?:%|€|\\$|£|km|kg|m|cm|million|billion|thousand|k|rows|students|teams|participants|people|hours|days|minutes|weeks|months|years|pages|schools|countries|editions|races|shops|stores|leaders|groups|companies|members|runners|photos|litres|liters|tonnes|tons|points|jobs|articles|prizes)";
const METRIC_RE = new RegExp(`(?:([+\\-−]?)\\s?([€$£])\\s?(\\d[\\d,.]*)|([+\\-−]?\\d[\\d,.]*)\\s?(${UNIT_RE})(?![\\p{L}]))`, "giu");
const ORDINAL_RE = /\b(\d{1,2})(?:st|nd|rd|th)\s+(?:out\s+of|of)\s+(\d+)(?:\s+(teams|participants|schools|groups|students))?/gi;

function labelBefore(text: string, index: number): string {
  const before = text.slice(Math.max(0, index - 60), index);
  const words = before.replace(/[^\p{L}\p{M}\d’'\- ]/gu, " ").trim().split(/\s+/).filter(Boolean).slice(-4);
  while (words.length && (STOPWORDS.has(words[0].toLowerCase()) || /^\d/.test(words[0]))) words.shift();
  while (words.length && STOPWORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(" ");
}

/** Numbers with units: "0.4%", "250 km", "200 million rows", "€1", "12th out of 45 teams". */
export function extractMetrics(text: string): ExtractedMetric[] {
  const out: ExtractedMetric[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(METRIC_RE)) {
    const value = m[2] ? `${m[1] ?? ""}${m[2]}${m[3]}` : `${m[4]}${m[5] === "%" ? "%" : ` ${m[5]}`}`;
    const index = m.index ?? 0;
    const after = text.slice(index + m[0].length, index + m[0].length + 40);
    const unitFollow = m[5] && /^(million|billion|thousand|k)$/i.test(m[5]) ? after.match(/^\s+([a-z]+)/i)?.[1] : null;
    const fullValue = unitFollow ? `${value} ${unitFollow}` : value;
    const key = fullValue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const label = labelBefore(text, index) || (m[5] ?? m[2] ?? "value");
    out.push({ label, value: fullValue.trim() });
  }
  for (const m of text.matchAll(ORDINAL_RE)) {
    const value = m[0].trim();
    if (seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push({ label: m[3] ? `ranking (${m[3]})` : "ranking", value });
  }
  return out;
}

/** Every number token in a text (with % and decimals), used by consistency checks. */
export function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/[+\-−]?\d[\d,.]*%?/g)) {
    const v = m[0].replace(/[.,]$/, "");
    if (/\d/.test(v)) out.add(v.replace(/^\+/, ""));
  }
  return [...out];
}

export type ExtractedQuote = { text: string; speaker: string | null };

const SPEAKER_AFTER = /^\s*(?:[—–-]|,)?\s*(?:says|said|explains|explained|adds|added|according to)?\s*([\p{Lu}][\p{L}\p{M}’'\-]+(?:\s+(?:de|du|d’|d'|van|von)?\s?[\p{Lu}][\p{L}\p{M}’'\-]+){0,3})/u;
const SPEAKER_BEFORE = /([\p{Lu}][\p{L}\p{M}’'\-]+(?:\s+(?:de|du|d’|d'|van|von)?\s?[\p{Lu}][\p{L}\p{M}’'\-]+){0,3})\s*(?:says|said|explains|explained|adds|added|:)\s*$/u;

/** Verbatim quotations between “…” or "..." with a speaker only when an explicit attribution exists. */
export function extractQuotes(text: string): ExtractedQuote[] {
  const out: ExtractedQuote[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(/[“"«]([^”"»]{12,}?)[”"»]/gu)) {
    const quote = m[1].trim();
    if (wordCount(quote) < 3) continue;
    const key = quote.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const index = m.index ?? 0;
    const after = text.slice(index + m[0].length, index + m[0].length + 80);
    const before = text.slice(Math.max(0, index - 80), index);
    let speaker: string | null = null;
    const afterMatch = after.match(SPEAKER_AFTER);
    const explicitAfter = /^\s*(?:[—–-]|,?\s*(?:says|said|explains|explained|adds|added|according to))/.test(after);
    if (afterMatch && explicitAfter && looksLikePersonName(afterMatch[1])) speaker = afterMatch[1];
    if (!speaker) {
      const beforeMatch = before.match(SPEAKER_BEFORE);
      if (beforeMatch && looksLikePersonName(beforeMatch[1])) speaker = beforeMatch[1];
    }
    out.push({ text: quote, speaker });
  }
  return out;
}

const FR_MARKERS = new Set(["le", "la", "les", "et", "des", "une", "pour", "nous", "dans", "est", "sont", "avec", "sur", "pas", "qui", "que", "au", "aux", "cette", "ont", "été", "très"]);
const EN_MARKERS = new Set(["the", "and", "of", "to", "with", "is", "are", "was", "were", "for", "on", "in", "that", "this", "we", "our", "have", "has", "from", "by"]);

export function detectLanguage(text: string): "en" | "fr" {
  const tokens = tokenize(text);
  let fr = 0;
  let en = 0;
  for (const t of tokens) {
    if (FR_MARKERS.has(t)) fr += 1;
    if (EN_MARKERS.has(t)) en += 1;
  }
  return fr > en * 1.2 && fr >= 3 ? "fr" : "en";
}

export function jaccardSets(a: Iterable<string>, b: Iterable<string>): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (!sa.size && !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

/** Overlap of content tokens between two sentences (0–1). */
export function sentenceOverlap(a: string, b: string): number {
  return jaccardSets(contentTokens(a), contentTokens(b));
}

/** Share of a's content tokens that also appear in b (asymmetric containment, 0–1). */
export function containment(a: string, b: string): number {
  const ta = new Set(contentTokens(a));
  if (!ta.size) return 0;
  const tb = new Set(contentTokens(b));
  let n = 0;
  for (const t of ta) if (tb.has(t)) n += 1;
  return n / ta.size;
}

const BRITISH_MAP: [RegExp, string][] = [
  [/\b(o)ptimiz(e|es|ed|ing|ation|ations)\b/gi, "$1ptimis$2"],
  [/\b(o)rganiz(e|es|ed|ing|ation|ations|er|ers)\b/gi, "$1rganis$2"],
  [/\b(a)nalyz(e|es|ed|ing)\b/gi, "$1nalys$2"],
  [/\b(r)ealiz(e|es|ed|ing|ation)\b/gi, "$1ealis$2"],
  [/\b(r)ecogniz(e|es|ed|ing)\b/gi, "$1ecognis$2"],
  [/\b(c)olor(s|ed|ful|ing)?\b/gi, "$1olour$2"],
  [/\b(f)avorite(s)?\b/gi, "$1avourite$2"],
  [/\b(c)enter(s|ed)?\b/gi, "$1entre$2"],
  [/\b(b)ehavior(s|al)?\b/gi, "$1ehaviour$2"],
  [/\b(l)abor\b/gi, "$1abour"],
  [/\b(n)eighbor(s|hood|hoods)?\b/gi, "$1eighbour$2"],
  [/\b(t)raveled\b/gi, "$1ravelled"],
  [/\b(t)raveling\b/gi, "$1ravelling"],
  [/\b(c)atalog(s)?\b/gi, "$1atalogue$2"],
  [/\b(d)efense\b/gi, "$1efence"],
  [/\b(l)icense(s)?\b/gi, "$1icence$2"],
  [/\b(s)pecializ(e|es|ed|ing|ation)\b/gi, "$1pecialis$2"],
  [/\b(s)ummariz(e|es|ed|ing)\b/gi, "$1ummaris$2"],
  [/\b(p)rioritiz(e|es|ed|ing)\b/gi, "$1rioritis$2"],
  [/\b(m)aximiz(e|es|ed|ing)\b/gi, "$1aximis$2"],
  [/\b(m)inimiz(e|es|ed|ing)\b/gi, "$1inimis$2"],
];

/** Converts a short list of American spellings to British ones, reporting each change. */
export function toBritishSpelling(text: string): { text: string; changes: string[] } {
  let out = text;
  const changes: string[] = [];
  for (const [re, replacement] of BRITISH_MAP) {
    out = out.replace(re, (match, ...rest) => {
      const groups = rest.slice(0, -2);
      const replaced = replacement.replace(/\$(\d)/g, (_, i) => groups[Number(i) - 1] ?? "");
      if (replaced !== match) changes.push(`${match} → ${replaced}`);
      return replaced;
    });
  }
  return { text: out, changes };
}

/** Normalises quotation marks and spacing without changing wording. */
export function normalizeTypography(text: string): string {
  return normalizeWhitespace(text)
    .replace(/[«»]/g, '"')
    .replace(/[‘’]/g, "’")
    .replace(/(^|[\s(])"/g, "$1“")
    .replace(/"/g, "”")
    .replace(/ +([,;:!?.])/g, "$1")
    .replace(/\.{3}/g, "…")
    .replace(/\s+/g, " ")
    .trim();
}

export function isUpperCase(text: string): boolean {
  return text === text.toUpperCase() && /\p{L}/u.test(text);
}

/** Splits an interview text into "QUESTION? answer" pairs when capitalised questions are present. */
export function splitQuestionsAndAnswers(text: string): { question: string; answer: string }[] {
  const upperQuestion = /(?:^|(?<=[.!?…]\s)|(?<=\n))([\p{Lu}][\p{Lu}\p{M}\d’',;:&\-\s()]{2,}\?)/gu;
  const matches = [...text.matchAll(upperQuestion)].filter((m) => m[1].replace(/[^\p{Lu}]/gu, "").length >= 3);
  const pairs: { question: string; answer: string }[] = [];
  if (matches.length >= 2) {
    for (let i = 0; i < matches.length; i += 1) {
      const start = (matches[i].index ?? 0) + matches[i][0].length;
      const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : text.length;
      const answer = text.slice(start, end).trim();
      const question = matches[i][1].trim();
      if (answer) pairs.push({ question, answer });
    }
    return pairs;
  }
  const sentences = splitSentences(text);
  let current: { question: string; answer: string } | null = null;
  for (const s of sentences) {
    if (s.endsWith("?") && wordCount(s) <= 20) {
      if (current && current.answer) pairs.push(current);
      current = { question: s, answer: "" };
    } else if (current) {
      current.answer = current.answer ? `${current.answer} ${s}` : s;
    }
  }
  if (current && current.answer) pairs.push(current);
  return pairs.length >= 2 ? pairs : [];
}

/** Turns "winningTeam" into "Winning team". */
export function labelFromKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** Splits "A, B and C; D" style lists of names into individual entries. */
export function splitNameList(value: string): string[] {
  return value
    .split(/\s*(?:,|;|\band\b|&|\n|\/)\s*/)
    .map((s) => s.replace(/\(.*?\)/g, "").trim())
    .filter((s) => s.length > 1);
}
