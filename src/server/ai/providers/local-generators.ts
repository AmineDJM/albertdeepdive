/**
 * Deterministic local AI provider. One rule-based generator per service, dispatched on the service
 * key. Every output is derived strictly from `request.hints.input`: names, dates, numbers and
 * quotations are copied from the input, never invented. Used when AI_PROVIDER=local and in tests.
 */
import { defaultSectionForStoryType, STORY_TYPES } from "@/lib/constants";
import { findSpellingConflicts } from "@/lib/editorial/clustering";
import { defaultTemplateForStoryType } from "@/lib/editorial/page-allocation";
import { textSimilarity } from "@/lib/editorial/similarity";
import {
  cleanText,
  containment,
  containsOrgKeyword,
  contentTokens,
  detectLanguage,
  extractDates,
  extractEntities,
  extractMetrics,
  extractNameCandidates,
  extractNumbers,
  extractQuotes,
  isUpperCase,
  labelFromKey,
  looksLikePersonName,
  nearIdenticalNames,
  normalizeName,
  normalizeTypography,
  sentenceOverlap,
  splitNameList,
  splitQuestionsAndAnswers,
  splitSentences,
  toBritishSpelling,
  truncateChars,
  truncateWords,
  wordCount,
} from "@/lib/editorial/text";
import type { AiBlock } from "../services/blocks";
import type { ProviderRequest } from "../types";

type Input = Record<string, unknown>;

const str = (input: Input, key: string, fallback = ""): string => {
  const v = input[key];
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return fallback;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return fallback;
};
const num = (input: Input, key: string, fallback = 0): number => {
  const v = input[key];
  return typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : fallback;
};
const arr = <T = unknown>(input: Input, key: string): T[] => {
  const v = input[key];
  return Array.isArray(v) ? (v as T[]) : [];
};
const obj = (input: Input, key: string): Input => {
  const v = input[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Input) : {};
};
const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const uniq = <T>(items: T[]) => [...new Set(items)];

export function generateLocal(request: ProviderRequest): unknown {
  const service = request.hints?.service || request.schemaName;
  const input = request.hints?.input ?? {};
  switch (service) {
    case "normalizer":
      return localNormalizer(input);
    case "classifier":
      return localClassifier(input);
    case "entity_extractor":
      return localEntityExtractor(input);
    case "cluster_namer":
      return localClusterNamer(input);
    case "relevance_scorer":
      return localRelevanceScorer(input);
    case "missing_info":
      return localMissingInfo(input);
    case "fact_sheet":
      return localFactSheet(input);
    case "article_drafter":
      return localArticleDrafter(input);
    case "headline_generator":
      return localHeadlineGenerator(input);
    case "standfirst_generator":
      return localStandfirst(input);
    case "pull_quote_selector":
      return localPullQuote(input);
    case "caption_generator":
      return localCaption(input);
    case "copy_editor":
      return localCopyEditor(input);
    case "consistency_checker":
      return localConsistencyChecker(input);
    case "tone_harmonizer":
      return localToneHarmonizer(input);
    case "section_planner":
      return localSectionPlanner(input);
    case "art_director":
      return localArtDirector(input);
    case "cover_selector":
      return localCoverSelector(input);
    case "toc_generator":
      return localToc(input);
    case "edition_qa":
      return localEditionQa(input);
    case "external_news_summarizer":
      return localExternalNews(input);
    case "translator":
      return localTranslator(input);
    case "image_describer":
      return localImageDescriber(input);
    case "speech_adapter":
      return localSpeechAdapter(input);
    case "voice_director":
      return localVoiceDirector(input);
    case "image_planner":
      return localImagePlanner(input);
    case "edition_studio":
      return localEditionStudio(input);
    default:
      throw new Error(`Local generator not implemented for ${service}`);
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

const LABEL_LINE = /^([A-Z][A-Za-z ]{1,40}):\s+(.+)$/;

/** Splits a normalised text into free prose and labelled lines ("Winning team: …"). */
function splitLabelled(text: string): { prose: string; labelled: { label: string; value: string }[] } {
  const prose: string[] = [];
  const labelled: { label: string; value: string }[] = [];
  for (const line of text.split(/\n+/)) {
    const m = line.trim().match(LABEL_LINE);
    if (m && wordCount(m[1]) <= 4) labelled.push({ label: m[1], value: m[2].trim() });
    else if (line.trim()) prose.push(line.trim());
  }
  return { prose: prose.join("\n"), labelled };
}

function firstSentences(text: string, max: number): string {
  return splitSentences(text).slice(0, max).join(" ");
}

function isFirstPerson(sentence: string): boolean {
  return /(^|[\s,])(I|I['’]m|I['’]ve|I['’]d|we|we['’]re|we['’]ve|our|my|us)([\s,.!?]|$)/i.test(sentence) && !/\b(they|he|she)\b/i.test(sentence.slice(0, 20));
}

function groupIntoParagraphs(sentences: string[], maxSentences = 3, maxWords = 85): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const s of sentences) {
    const w = wordCount(s);
    if (current.length && (current.length >= maxSentences || words + w > maxWords)) {
      out.push(current.join(" "));
      current = [];
      words = 0;
    }
    current.push(s);
    words += w;
  }
  if (current.length) out.push(current.join(" "));
  return out;
}

type FactRef = { id: string; statement: string; category: string | null; confidence: string; status?: string; sourceSubmissionId?: string | null };
type QuoteRef = { id: string; text: string; speaker: string | null; role?: string | null; sourceSubmissionId?: string | null };
type SubmissionRef = { id: string; title: string; text: string; storyType: string; contributor?: string | null; quotes?: string | null };

/** Facts supporting a piece of text: statements that overlap one of its sentences. */
function citeFacts(text: string, facts: FactRef[], minOverlap = 0.45): string[] {
  const sentences = splitSentences(text);
  const ids = new Set<string>();
  for (const s of sentences) {
    let bestId: string | null = null;
    let best = 0;
    for (const f of facts) {
      const score = Math.max(sentenceOverlap(s, f.statement), containment(f.statement, s), containment(s, f.statement));
      if (score >= minOverlap) ids.add(f.id);
      if (score > best) {
        best = score;
        bestId = f.id;
      }
    }
    if (!ids.size && bestId && best >= 0.25) ids.add(bestId);
  }
  return [...ids];
}

function nameSet(text: string): string[] {
  return extractNameCandidates(text)
    .map((c) => c.name)
    .filter((n) => looksLikePersonName(n) || containsOrgKeyword(n));
}

// ─── normalizer ──────────────────────────────────────────────────────────────

function localNormalizer(input: Input) {
  const description = cleanText(str(input, "description"));
  const parts: string[] = [description];
  const people = cleanText(str(input, "peopleInvolved"));
  if (people) parts.push(`People involved: ${people}`);
  const orgs = cleanText(str(input, "organisationsInvolved"));
  if (orgs) parts.push(`Organisations: ${orgs}`);
  const date = cleanText(str(input, "eventDateText"));
  if (date) parts.push(`Date: ${date}`);
  const extra = obj(input, "extra");
  for (const [key, value] of Object.entries(extra)) {
    if (value === null || value === undefined || value === "") continue;
    const rendered = Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ") : typeof value === "object" ? "" : String(value);
    if (rendered.trim()) parts.push(`${labelFromKey(key)}: ${cleanText(rendered)}`);
  }
  const why = cleanText(str(input, "whyItMatters"));
  if (why) parts.push(`Why it matters: ${why}`);
  const quotes = cleanText(str(input, "quotes"));
  if (quotes) parts.push(`Quotes: ${quotes}`);
  const normalizedText = parts.filter(Boolean).join("\n");
  const sentences = splitSentences(description);
  let summary = sentences[0] ?? cleanText(str(input, "title"));
  if (summary && wordCount(summary) < 12 && sentences[1]) summary = `${summary} ${sentences[1]}`;
  return { normalizedText, summary: truncateWords(summary, 60), language: detectLanguage(description || normalizedText), wordCount: wordCount(normalizedText) };
}

// ─── classifier ──────────────────────────────────────────────────────────────

const CLASSIFIER_RULES: [string, RegExp][] = [
  ["BUSINESS_DEEP_DIVE", /\b(business deep dive|bdd|deep dive|jury|winning team|company case|pitch(?:ed|es)?|dataset|dashboard|algorithm|assortment|retailer)\b/gi],
  ["INTERVIEW_PROFILE", /\b(interview(?:ed)?|introduce yourself|tells us|portrait|profile|q&a|can you|monsieur|madame)\b/gi],
  ["STUDENT_ACHIEVEMENT", /\b(admitted|admission|award(?:ed)?|prize|competition|scholarship|ranked|selected for|top \d)\b/gi],
  ["STUDENT_PROJECT", /\b(startup|start-up|founded|agency|our company|launch(?:ed)?|product|app|clients?|entrepreneur)\b/gi],
  ["SCHOOL_NEWS", /\b(accreditation|accredited|partnership|press|announce[sd]?|executive education|programme launch|new campus|the school|administration|office hours)\b/gi],
  ["ASSOCIATION", /\b(association|bde|bds|club|join us|registration|president|members)\b/gi],
  ["CAMPUS_LIFE", /\b(campus life|table football|foosball|cafeteria|classroom|daily life|rivalry|prize list|maths test)\b/gi],
  ["EVENT_RECAP", /\b(took place|was held|hosted|participants|brought together|see you next year|special mention|regatta|race|run|tournament)\b/gi],
  ["UPCOMING_EVENT", /\b(will take place|sign[- ]?up|register|save the date|upcoming|join us on|coming soon|we['’]re throwing|next (?:week|month|edition)|\d{1,2}(?::\d{2})? ?(?:am|pm))\b/gi],
  ["ALUMNI", /\b(alumni|alumnus|alumna|graduated|graduates?)\b/gi],
  ["ACADEMIC_NEWS", /\b(courses?|exams?|maths|mathematics|professors?|faculty|lecture|curriculum|semester|grades?)\b/gi],
  ["CAREER_INTERNSHIP", /\b(internships?|interns?|jobs?|careers?|recruit(?:ing|ment)?|hiring|job offer)\b/gi],
  ["DATA_AI_BUSINESS_INSIGHT", /\b(regulation|ai act|antitrust|executive order|law|policy|economy|study shows|according to|market|data export)\b/gi],
  ["PHOTO_STORY", /\b(photos?|pictures?|gallery|shots?)\b/gi],
  ["ANECDOTE", /\b(funny|anecdote|true story|joke|fun fact|lol)\b/gi],
];

function localClassifier(input: Input) {
  const text = str(input, "text");
  const declared = str(input, "declaredType");
  const storyTypes = arr<string>(input, "storyTypes").length ? arr<string>(input, "storyTypes") : STORY_TYPES.map((t) => t.value);
  const sectionSlugs = arr<string>(input, "sectionSlugs");
  const scores = new Map<string, number>();
  const hits = new Map<string, string[]>();
  for (const [type, re] of CLASSIFIER_RULES) {
    if (!storyTypes.includes(type)) continue;
    const found = uniq([...text.matchAll(re)].map((m) => m[0].toLowerCase()));
    if (found.length) {
      scores.set(type, Math.min(6, found.length));
      hits.set(type, found.slice(0, 4));
    }
  }
  // The contributor's declared type is a strong prior, except OTHER which only breaks ties.
  if (declared && storyTypes.includes(declared)) scores.set(declared, (scores.get(declared) ?? 0) + (declared === "OTHER" ? 1 : 4));
  let best: string = declared && storyTypes.includes(declared) ? declared : "OTHER";
  let bestScore = -1;
  let second = 0;
  for (const type of storyTypes) {
    const s = scores.get(type) ?? 0;
    if (s > bestScore) {
      second = bestScore;
      bestScore = s;
      best = type;
    } else if (s > second) second = s;
  }
  const preferred = defaultSectionForStoryType(best);
  const sectionSlug = !sectionSlugs.length || sectionSlugs.includes(preferred) ? preferred : sectionSlugs.includes("campus-life") ? "campus-life" : sectionSlugs[0];
  const personTokens = new Set(extractEntities(text).people.flatMap((p) => contentTokens(p.name)));
  const freq = new Map<string, number>();
  for (const t of contentTokens(text)) if (t.length >= 4 && !/\d/.test(t) && !personTokens.has(t)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const topTokens = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4).map(([t]) => t);
  const short = STORY_TYPES.find((t) => t.value === best)?.short.toLowerCase() ?? best.toLowerCase();
  const tags = uniq([short, ...topTokens]).slice(0, 6);
  const confidence = Math.min(0.98, Math.max(0.35, 0.5 + (declared === best ? 0.15 : 0) + 0.05 * Math.max(0, bestScore - 4) - 0.03 * Math.max(0, second)));
  const reason = `${declared ? `Contributor declared ${declared}` : "No declared type"}${hits.get(best)?.length ? `; keywords: ${hits.get(best)!.join(", ")}` : ""}.`;
  return { storyType: best, sectionSlug, tags, language: detectLanguage(text), confidence: Math.round(confidence * 100) / 100, reason };
}

// ─── entity extractor ────────────────────────────────────────────────────────

function localEntityExtractor(input: Input) {
  const text = str(input, "text");
  const known = arr<string>(input, "knownOrganisations");
  const orgLine = text.match(/^organisations?(?: involved)?\s*:\s*(.+)$/im)?.[1];
  const listed = orgLine ? splitNameList(orgLine) : [];
  const entities = extractEntities(text, uniq([...known, ...listed]));
  return {
    people: entities.people,
    organisations: entities.organisations,
    dates: extractDates(text),
    places: entities.places,
    metrics: extractMetrics(text),
  };
}

// ─── cluster namer ───────────────────────────────────────────────────────────

function pickStoryType(subs: SubmissionRef[]): string {
  const counts = new Map<string, number>();
  for (const s of subs) counts.set(s.storyType, (counts.get(s.storyType) ?? 0) + 1);
  const specific = [...counts.entries()].filter(([t]) => t !== "PHOTO_STORY" && t !== "OTHER");
  const pool = specific.length ? specific : [...counts.entries()];
  const primary = [...subs].sort((a, b) => b.text.length - a.text.length)[0];
  pool.sort((a, b) => b[1] - a[1] || (a[0] === primary?.storyType ? -1 : b[0] === primary?.storyType ? 1 : 0));
  return pool[0]?.[0] ?? "OTHER";
}

function labelledValue(subs: SubmissionRef[], label: RegExp): string | null {
  for (const s of subs) {
    for (const l of splitLabelled(s.text).labelled) if (label.test(l.label)) return l.value;
  }
  return null;
}

function localClusterNamer(input: Input) {
  const subs = arr<SubmissionRef>(input, "submissionList");
  if (!subs.length) return { title: "Untitled story", summary: "", primaryStoryType: "OTHER", contradictions: [] };
  const primary = [...subs].sort((a, b) => b.text.length - a.text.length)[0];
  const primaryStoryType = pickStoryType(subs);
  let title = primary.title;
  if (primaryStoryType === "BUSINESS_DEEP_DIVE") {
    const company = labelledValue(subs, /^company$/i);
    const cohort = labelledValue(subs, /^cohort$/i);
    if (company && cohort) title = `${company} – ${cohort}`;
    else if (company) title = `${company} – Business Deep Dive`;
  } else if (subs.length > 1) {
    const titleTokens = subs.map((s) => new Set(contentTokens(s.title)));
    const shared = [...titleTokens[0]].filter((t) => titleTokens.slice(1).some((set) => set.has(t)));
    const bestTitle = subs.find((s) => shared.every((t) => contentTokens(s.title).includes(t)) && s.storyType !== "PHOTO_STORY") ?? primary;
    title = bestTitle.title;
  }
  title = truncateChars(cleanText(title), 70);
  const summarySentence = (s: SubmissionRef) => {
    const sentences = splitSentences(splitLabelled(s.text).prose);
    return sentences.find((x) => !isFirstPerson(x)) ?? sentences[0] ?? "";
  };
  const ordered = [primary, ...subs.filter((s) => s.id !== primary.id)].sort((a, b) => Number(isFirstPerson(firstSentences(splitLabelled(a.text).prose, 1))) - Number(isFirstPerson(firstSentences(splitLabelled(b.text).prose, 1))) || b.text.length - a.text.length).slice(0, 3);
  const summary = truncateWords(ordered.map(summarySentence).filter(Boolean).join(" "), 70);
  const conflicts = findSpellingConflicts(subs.map((s) => ({ id: s.id, names: extractEntities(s.text).people.map((p) => p.name) })));
  const contradictions = conflicts.map((c) => ({ topic: "Spelling of a name", statementA: c.a, statementB: c.b, submissionIds: c.ids }));
  const dated = subs.map((s) => ({ id: s.id, dates: extractDates(s.text) })).filter((d) => d.dates.length);
  for (let i = 0; i < dated.length; i += 1) {
    for (let j = i + 1; j < dated.length; j += 1) {
      const a = dated[i].dates[0];
      const b = dated[j].dates[0];
      const monthA = a.text.match(/[A-Za-z]+/)?.[0]?.toLowerCase();
      const monthB = b.text.match(/[A-Za-z]+/)?.[0]?.toLowerCase();
      const dayA = a.text.match(/\d{1,2}/)?.[0];
      const dayB = b.text.match(/\d{1,2}/)?.[0];
      if (monthA && monthA === monthB && dayA && dayB && dayA !== dayB && !dated[i].dates.some((d) => d.text.toLowerCase() === b.text.toLowerCase())) {
        contradictions.push({ topic: "Date", statementA: a.text, statementB: b.text, submissionIds: [dated[i].id, dated[j].id] });
      }
    }
  }
  return { title, summary, primaryStoryType, contradictions };
}

// ─── relevance scorer ────────────────────────────────────────────────────────

const BASE_SCORES: Record<string, number[]> = {
  BUSINESS_DEEP_DIVE: [85, 80, 60, 70, 65, 75, 60, 75, 92],
  STUDENT_ACHIEVEMENT: [80, 85, 75, 60, 70, 80, 50, 70, 60],
  STUDENT_PROJECT: [75, 85, 80, 60, 65, 82, 55, 55, 70],
  INTERVIEW_PROFILE: [80, 85, 75, 60, 60, 85, 55, 65, 60],
  SCHOOL_NEWS: [85, 60, 55, 60, 75, 60, 45, 90, 50],
  ASSOCIATION: [70, 85, 65, 70, 65, 72, 50, 55, 30],
  CAMPUS_LIFE: [65, 85, 60, 75, 60, 70, 55, 40, 20],
  EVENT_RECAP: [70, 85, 60, 75, 70, 75, 70, 50, 25],
  UPCOMING_EVENT: [70, 75, 40, 70, 90, 60, 45, 60, 20],
  ALUMNI: [75, 70, 65, 50, 55, 70, 50, 65, 55],
  ACADEMIC_NEWS: [80, 75, 50, 60, 65, 55, 35, 80, 60],
  CAREER_INTERNSHIP: [75, 80, 55, 55, 70, 60, 35, 70, 65],
  DATA_AI_BUSINESS_INSIGHT: [60, 70, 55, 30, 80, 65, 30, 45, 95],
  PHOTO_STORY: [60, 80, 55, 70, 60, 65, 95, 35, 15],
  ANECDOTE: [55, 90, 70, 75, 50, 80, 30, 25, 10],
  OTHER: [50, 50, 50, 50, 50, 50, 40, 40, 30],
};

function localRelevanceScorer(input: Input) {
  const storyType = str(input, "storyType", "OTHER");
  const base = BASE_SCORES[storyType] ?? BASE_SCORES.OTHER;
  const sourceCount = num(input, "sourceCount");
  const mediaCount = num(input, "mediaCount");
  const quoteCount = num(input, "quoteCount");
  const campuses = arr<string>(input, "campuses");
  const scope = str(input, "campusScope") || (campuses.length === 0 ? "SCHOOL_WIDE" : campuses.length > 1 ? "MULTI" : "SINGLE");
  const scopeBoost = scope === "SCHOOL_WIDE" ? 10 : scope === "MULTI" ? 5 : 0;
  const [school, student, uniqueness, campus, timeliness, editorial, visual, institutional, business] = base;
  return {
    schoolRelevance: clamp(school + (scope === "SCHOOL_WIDE" ? 4 : 0)),
    studentRelevance: clamp(student + Math.min(6, quoteCount * 2)),
    uniqueness: clamp(uniqueness + Math.min(10, Math.max(0, sourceCount - 1) * 5)),
    campusImportance: clamp(campus + scopeBoost),
    timeliness: clamp(timeliness),
    editorialInterest: clamp(editorial + Math.min(15, quoteCount * 5) + Math.min(8, Math.max(0, sourceCount - 1) * 4)),
    visualRichness: clamp(visual + mediaCount * 10 - (mediaCount === 0 ? 25 : 0)),
    institutionalImportance: clamp(institutional + (scope === "SCHOOL_WIDE" ? 5 : 0)),
    businessDataRelevance: clamp(business),
    rationale: `Rule-based score for ${storyType}: ${sourceCount} source(s), ${mediaCount} photo(s), ${quoteCount} quote(s), ${scope.toLowerCase().replace("_", "-")} scope.`,
  };
}

// ─── missing information ─────────────────────────────────────────────────────

const METHOD_RE = /\b(model|models|algorithm|regression|clustering|forecast|python|dashboard|power bi|streamlit|lightgbm|lstm|machine learning|neural|sql|excel|tableau|classification|ranker|gaussian|folium)\b/i;

function localMissingInfo(input: Input) {
  const storyType = str(input, "storyType", "OTHER");
  const text = str(input, "text");
  const extra = obj(input, "extra");
  const has = (key: string) => {
    const v = extra[key];
    return v !== null && v !== undefined && String(v).trim() !== "";
  };
  const mediaCount = num(input, "mediaCount");
  const mediaKinds = arr<string>(input, "mediaKinds").map((k) => k.toLowerCase());
  const quoteCount = num(input, "quoteCount");
  const urls = arr<string>(input, "urls");
  const entities = extractEntities(text);
  const dates = extractDates(text);
  const metrics = extractMetrics(text);
  const items: { key: string; label: string; severity: "low" | "medium" | "high" }[] = [];
  const add = (key: string, label: string, severity: "low" | "medium" | "high") => {
    if (!items.some((i) => i.key === key)) items.push({ key, label, severity });
  };
  const hasDate = dates.length > 0 || has("projectDates") || has("date") || has("eventDate");
  const hasPlace = entities.places.length > 0 || has("place") || has("location") || has("venue") || /\b\d{1,3}\s+(?:rue|avenue|boulevard|place)\b/i.test(text);
  const hasPhoto = mediaCount > 0 && (mediaKinds.length === 0 || mediaKinds.includes("photo"));

  switch (storyType) {
    case "BUSINESS_DEEP_DIVE":
      if (!has("company") && !entities.organisations.length) add("company", "Which company was the Business Deep Dive with?", "high");
      if (!has("cohort") && !/\b(B1|B2|B3|M1|M2|MSc|IBBA|cohort|bachelor|master)\b/i.test(text)) add("cohort", "Which cohort and campus took part (e.g. B2 Paris)?", "high");
      if (!hasDate) add("dates", "What were the project dates (start, end and final)?", "medium");
      if (!has("winningTeam") && !/\b(won|winners?|winning team|first place|favourites?)\b/i.test(text)) add("winning_team", "Who was on the winning team (full names)?", "high");
      if (!has("methodology") && !has("technologies") && !METHOD_RE.test(text)) add("methods", "Which methods, models or tools did the winning team use?", "medium");
      if (!has("measurableResults") && !metrics.some((m) => /%|€|\$|million|billion|k\b/i.test(m.value))) add("results_metric", "Is there a measurable result (estimated uplift, accuracy, savings)?", "medium");
      if (!has("jury") && !/\bjur(?:y|ors?)\b/i.test(text)) add("jury", "Who was on the jury (names and roles)?", "low");
      if (!hasPhoto) add("team_photo", "Do you have a photo of the winning team or of the final pitch?", "medium");
      if (!mediaKinds.includes("logo")) add("logo", "Can you share the company logo, or confirm we may use it?", "low");
      break;
    case "EVENT_RECAP":
      if (!hasDate) add("date", "On which date did the event take place?", "high");
      if (!hasPlace) add("place", "Where did the event take place?", "medium");
      if (!has("organiser") && !/\b(organis(?:ed|er|ers)|organiz(?:ed|er|ers))\b/i.test(text)) add("organiser", "Who organised the event?", "medium");
      if (!hasPhoto) add("photo", "Do you have photos of the event (with the photographer's name)?", "medium");
      break;
    case "UPCOMING_EVENT":
      if (!hasDate) add("date", "When exactly does the event take place (date and time)?", "high");
      if (!hasPlace) add("place", "Where does the event take place (address or campus)?", "high");
      if (!urls.length && !has("signupUrl") && !/https?:\/\//i.test(text)) add("signup_link", "What is the sign-up link?", "high");
      break;
    case "INTERVIEW_PROFILE":
      if (!hasPhoto) add("portrait_photo", "Can you send a portrait photo of the interviewee?", "medium");
      if (!/\b(student|B[123]|M[12]|MSc|alumni|alumnus|professor|teacher|staff|head of|director|manager|founder|years? old|I['’]m \d+)\b/i.test(text)) add("role", "What is the interviewee's role, programme and campus?", "medium");
      break;
    case "ASSOCIATION":
      if (!urls.length && !/(instagram|linkedin|@|contact|register|registration|sign up|link)/i.test(text)) add("contact_link", "How can students contact or join the association (link or handle)?", "medium");
      break;
    default:
      break;
  }
  if (!hasPhoto && !items.some((i) => /photo/.test(i.key))) add("photo", "Do you have a photo we can print (with the photographer's name)?", storyType === "PHOTO_STORY" ? "high" : "low");
  if (quoteCount === 0 && !/[“"«]/.test(text)) add("quote", "Could you give us a short quote we can print, with the speaker's name?", "low");
  return { items };
}

// ─── fact sheet ──────────────────────────────────────────────────────────────

const AWARD_RE = /\b(won|winners?|winning|first place|prize|awards?|admitted|favourites?|champions?|finalists?|podium|finished \d|ranked|selected)\b/i;
const RESULT_RE = /\b(model|predict|predicts|dashboard|solution|recommend|recommendations|deliver|delivered|result|results|approach|algorithm|built|developed|created|designed|analysis)\b/i;

type LocalFact = { statement: string; category: string; sourceSubmissionIds: string[]; excerpt: string | null; confidence: string; order: number };

function categorise(sentence: string, hasPerson: boolean, hasOrg: boolean): string {
  if (extractDates(sentence).length && /\b(on|from|between|until|till|since|last|next)\b/i.test(sentence)) return "date";
  if (AWARD_RE.test(sentence)) return "award";
  if (extractMetrics(sentence).length) return "metric";
  if (hasPerson) return "person";
  if (hasOrg) return "organisation";
  if (RESULT_RE.test(sentence)) return "result";
  return "other";
}

function localFactSheet(input: Input) {
  const subs = arr<SubmissionRef>(input, "submissionList");
  const facts: LocalFact[] = [];
  const quotes: { text: string; speakerName: string | null; speakerRole: string | null; sourceSubmissionId: string }[] = [];
  const seenQuotes = new Set<string>();
  const sentencesBySub = new Map<string, string[]>();
  let order = 0;

  for (const sub of subs) {
    const { prose, labelled } = splitLabelled(sub.text);
    const proseSentences = splitSentences(prose);
    sentencesBySub.set(sub.id, proseSentences);
    for (const l of labelled) {
      if (/^(quotes?|why it matters)$/i.test(l.label)) continue;
      const label = l.label.toLowerCase();
      const category = /date/.test(label) ? "date" : /(team|jury|finalist|people|winner|organiser|founder)/.test(label) ? "person" : /(company|organisation|partner)/.test(label) ? "organisation" : /(result|metric)/.test(label) ? "metric" : /(method|technolog|dataset|data|problem|solution|recommend)/.test(label) ? "result" : "other";
      facts.push({ statement: `${l.label}: ${l.value}`, category, sourceSubmissionIds: [sub.id], excerpt: truncateChars(`${l.label}: ${l.value}`, 160), confidence: "STATED_BY_CONTRIBUTOR", order: order++ });
    }
    for (const sentence of proseSentences) {
      const entities = extractEntities(sentence);
      const hasPerson = entities.people.length > 0;
      const hasOrg = entities.organisations.length > 0 || extractNameCandidates(sentence).some((c) => containsOrgKeyword(c.name));
      const hasNumber = /\d/.test(sentence);
      const hasDate = extractDates(sentence).length > 0;
      const hasQuote = /[“"«][^”"»]{12,}[”"»]/.test(sentence);
      if (!hasPerson && !hasOrg && !hasNumber && !hasDate && !hasQuote) continue;
      if (wordCount(sentence) < 4) continue;
      facts.push({ statement: truncateChars(sentence, 260), category: hasQuote && !hasPerson ? "other" : categorise(sentence, hasPerson, hasOrg), sourceSubmissionIds: [sub.id], excerpt: truncateChars(sentence, 160), confidence: "STATED_BY_CONTRIBUTOR", order: order++ });
    }
    const quoteSources = [sub.text, sub.quotes ?? ""].filter(Boolean).join("\n");
    for (const q of extractQuotes(quoteSources)) {
      const key = normalizeName(q.text);
      if (seenQuotes.has(key)) continue;
      seenQuotes.add(key);
      quotes.push({ text: q.text, speakerName: q.speaker, speakerRole: null, sourceSubmissionId: sub.id });
    }
    const firstPerson = proseSentences.filter((s) => isFirstPerson(s) && wordCount(s) >= 8);
    if (firstPerson.length >= 2) {
      const candidates = uniq([firstPerson[0], firstPerson.find((s) => extractMetrics(s).length) ?? firstPerson[0]]);
      for (const s of candidates) {
        const key = normalizeName(s);
        if (seenQuotes.has(key) || [...seenQuotes].some((k) => k.includes(key) || key.includes(k))) continue;
        seenQuotes.add(key);
        quotes.push({ text: s.replace(/[“”"]/g, ""), speakerName: null, speakerRole: null, sourceSubmissionId: sub.id });
      }
    }
  }

  // Cross-source corroboration and de-duplication.
  const kept: LocalFact[] = [];
  for (const fact of facts) {
    const twin = kept.find((k) => sentenceOverlap(k.statement, fact.statement) >= 0.8 || (containment(k.statement, fact.statement) >= 0.9 && containment(fact.statement, k.statement) >= 0.9));
    if (twin) {
      twin.sourceSubmissionIds = uniq([...twin.sourceSubmissionIds, ...fact.sourceSubmissionIds]);
      if (twin.sourceSubmissionIds.length > 1) twin.confidence = "VERIFIED_BY_SUBMISSION";
      continue;
    }
    for (const [subId, sentences] of sentencesBySub) {
      if (fact.sourceSubmissionIds.includes(subId)) continue;
      if (sentences.some((s) => sentenceOverlap(s, fact.statement) >= 0.5 || containment(fact.statement, s) >= 0.7)) {
        fact.sourceSubmissionIds = uniq([...fact.sourceSubmissionIds, subId]);
        fact.confidence = "VERIFIED_BY_SUBMISSION";
      }
    }
    kept.push(fact);
  }

  const conflicts = findSpellingConflicts(subs.map((s) => ({ id: s.id, names: extractEntities(s.text).people.map((p) => p.name) })));
  for (const c of conflicts) {
    kept.push({ statement: `The name is spelled "${c.a}" in one source and "${c.b}" in another.`, category: "person", sourceSubmissionIds: [...c.ids], excerpt: `"${c.a}" / "${c.b}"`, confidence: "CONFLICTING", order: order++ });
  }

  return {
    facts: kept.slice(0, 40).map(({ statement, category, sourceSubmissionIds, excerpt, confidence }) => ({ statement, category, sourceSubmissionIds, excerpt, confidence })),
    quotes,
  };
}

// ─── article drafter ─────────────────────────────────────────────────────────

type DraftOut =
  | { type: "paragraph"; text: string; factIds: string[] }
  | { type: "crosshead"; text: string }
  | { type: "qa"; question: string; answer: string; factIds: string[] }
  | { type: "pullquote"; quoteId: string }
  | { type: "list"; items: string[]; factIds: string[] }
  | { type: "box"; title: string; items: string[]; factIds: string[] }
  | { type: "testimony"; quoteId: string | null; text: string | null; speaker: string | null; factIds: string[] };

const BDD_SECTIONS: { title: string; re: RegExp }[] = [
  { title: "THE WINNING TEAM", re: /\b(won|winners?|winning team|favourites?|first place|congratulations|finalists?)\b/i },
  { title: "THE RESULTS", re: /\b(results?|predicts?|estimated|increase|decrease|uplift|%|accuracy|impact|performance|delivered?|recommendations?|appealed|appreciated|measure)\b/i },
  { title: "THE CHALLENGE", re: /\b(objective|challenge|problem|mission|aims?|goals?|task|brief|had to|needed to|optimis\w*|improve|reduce)\b/i },
  { title: "THE DATA", re: /\b(data|dataset|datasets|rows|sales|historical|records|database|variables|tables?|sources)\b/i },
  { title: "THE APPROACH", re: /\b(models?|algorithms?|approach|methods?|used|built|trained|regression|ranker|clustering|forecast|python|dashboard|streamlit|power bi|lightgbm|lstm|machine learning|pipeline|analysis)\b/i },
];
const BDD_ORDER = ["THE CASE", "THE DATA", "THE CHALLENGE", "THE APPROACH", "THE RESULTS", "THE WINNING TEAM"];

function localArticleDrafter(input: Input) {
  const storyType = str(input, "storyType", "OTHER");
  const targetWords = num(input, "targetWords", 400) || 400;
  const allFacts = arr<FactRef>(input, "factList");
  const usable = allFacts.filter((f) => f.confidence !== "CONFLICTING" && f.status !== "DISPUTED" && f.status !== "REJECTED");
  const quotes = arr<QuoteRef>(input, "quoteList");
  const subs = arr<SubmissionRef>(input, "submissions");
  const blocks: DraftOut[] = [];
  const cautions: string[] = [];
  const cited = new Set<string>();
  const cite = (text: string) => {
    const ids = citeFacts(text, usable);
    ids.forEach((id) => cited.add(id));
    return ids;
  };
  const paragraph = (text: string): DraftOut => ({ type: "paragraph", text, factIds: cite(text) });
  const testimony = (text: string, speaker: string | null): DraftOut => ({ type: "testimony", quoteId: null, text, speaker, factIds: cite(text) });
  const usedQuoteIds = new Set<string>();

  const ordered = [...subs].sort((a, b) => Number(a.storyType === "PHOTO_STORY") - Number(b.storyType === "PHOTO_STORY") || b.text.length - a.text.length);
  const primary = ordered[0];
  const proseOf = (s: SubmissionRef) => splitLabelled(s.text).prose;
  const labelledOf = (s: SubmissionRef) => splitLabelled(s.text).labelled;
  const whyItMatters = subs.map((s) => labelledOf(s).find((l) => /^why it matters$/i.test(l.label))?.value).find(Boolean) ?? null;

  if (storyType === "BUSINESS_DEEP_DIVE") {
    const sections = new Map<string, string[]>(BDD_ORDER.map((t) => [t, []]));
    const testimonies: { speaker: string | null; sentences: string[] }[] = [];
    for (const [idx, sub] of ordered.entries()) {
      const sentences = splitSentences(proseOf(sub));
      const fp = sentences.filter(isFirstPerson);
      if (fp.length >= 2 && fp.length >= sentences.length * 0.6) {
        testimonies.push({ speaker: sub.contributor ?? null, sentences });
        continue;
      }
      for (const [sIdx, sentence] of sentences.entries()) {
        const hasPerson = extractEntities(sentence).people.length > 0;
        let target = idx === 0 && sIdx < 2 ? "THE CASE" : "THE CASE";
        for (const sec of BDD_SECTIONS) {
          if (sec.title === "THE WINNING TEAM" && !hasPerson) continue;
          if (sec.re.test(sentence)) {
            target = sec.title;
            break;
          }
        }
        if (idx === 0 && sIdx === 0) target = "THE CASE";
        sections.get(target)!.push(sentence);
      }
    }
    const labelledFor = (re: RegExp) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const s of subs) {
        for (const l of labelledOf(s)) {
          const key = l.label.toLowerCase();
          if (!re.test(l.label) || seen.has(key)) continue;
          seen.add(key);
          out.push(`${l.label}: ${l.value}`);
        }
      }
      return out;
    };
    const pushLabelled = (title: string, re: RegExp) => {
      const lines = labelledFor(re);
      if (lines.length) sections.get(title)!.push(...lines.map((l) => (l.endsWith(".") ? l : `${l}.`)));
    };
    pushLabelled("THE CHALLENGE", /^business problem$/i);
    pushLabelled("THE DATA", /^dataset$/i);
    pushLabelled("THE APPROACH", /^(methodology|technologies)$/i);
    pushLabelled("THE RESULTS", /^(measurable results|final recommendation|lessons learned)$/i);
    const teamLines = labelledFor(/^(winning team|finalists|jury)$/i);
    for (const title of BDD_ORDER) {
      const sentences = sections.get(title)!;
      if (title === "THE WINNING TEAM" && teamLines.length) {
        blocks.push({ type: "crosshead", text: title });
        for (const p of groupIntoParagraphs(sentences)) blocks.push(paragraph(p));
        blocks.push({ type: "list", items: teamLines, factIds: uniq(teamLines.flatMap((l) => cite(l))) });
        continue;
      }
      if (!sentences.length) continue;
      blocks.push({ type: "crosshead", text: title });
      for (const p of groupIntoParagraphs(sentences)) blocks.push(paragraph(p));
    }
    for (const t of testimonies) {
      const speakerLabel = t.speaker ? `${t.speaker.toUpperCase()} TELLS US ABOUT THE TEAM'S METHODOLOGY AND RESULTS` : "THE WINNERS TELL US ABOUT THEIR METHODOLOGY AND RESULTS";
      blocks.push({ type: "crosshead", text: speakerLabel });
      for (const p of groupIntoParagraphs(t.sentences, 3, 90)) blocks.push(testimony(p, t.speaker));
      if (!t.speaker) cautions.push("A first-person testimony has no identified speaker: confirm who is talking.");
    }
  } else if (storyType === "INTERVIEW_PROFILE") {
    const pairs = primary ? splitQuestionsAndAnswers(proseOf(primary)) : [];
    if (pairs.length) {
      for (const pair of pairs) blocks.push({ type: "qa", question: pair.question.toUpperCase(), answer: pair.answer, factIds: cite(pair.answer) });
    } else {
      const paragraphs = groupIntoParagraphs(splitSentences(primary ? proseOf(primary) : ""));
      paragraphs.forEach((p, i) => {
        if (i === 1) blocks.push({ type: "crosshead", text: "IN DETAIL" });
        blocks.push(paragraph(p));
      });
    }
  } else if (storyType === "UPCOMING_EVENT") {
    const sentences = splitSentences(primary ? proseOf(primary) : "");
    const buckets: Record<string, string[]> = { intro: [], "WHY?": [], "WITH WHOM?": [], "WHERE AND WHEN?": [], signup: [] };
    for (const [i, s] of sentences.entries()) {
      if (/^with (?:whom|who)\b/i.test(s)) buckets["WITH WHOM?"].push(s);
      else if (/^why\b/i.test(s)) buckets["WHY?"].push(s);
      else if (/^(?:where|when)\b/i.test(s)) buckets["WHERE AND WHEN?"].push(s);
      else if (/\b(sign[- ]?up|register|registration|link)\b/i.test(s)) buckets.signup.push(s);
      else if (extractDates(s).length || /\b(rue|avenue|boulevard|campus|from \d|\d{1,2}(?::\d{2})? ?(?:am|pm)|at \d)\b/i.test(s)) buckets["WHERE AND WHEN?"].push(s);
      else if (/\b(why|to meet|aim|goal|celebrate|discover|because|purpose)\b/i.test(s)) buckets["WHY?"].push(s);
      else if (/\b(with|students|team|guests|speakers|alumni|everyone|whom)\b/i.test(s) && i > 0) buckets["WITH WHOM?"].push(s);
      else buckets.intro.push(s);
    }
    for (const p of groupIntoParagraphs(buckets.intro)) blocks.push(paragraph(p));
    for (const title of ["WHY?", "WITH WHOM?", "WHERE AND WHEN?"]) {
      if (!buckets[title].length) continue;
      blocks.push({ type: "crosshead", text: title });
      blocks.push(paragraph(buckets[title].join(" ")));
    }
    if (buckets.signup.length) blocks.push(paragraph(buckets.signup.join(" ")));
  } else {
    const crossheadByType: Record<string, string> = { EVENT_RECAP: "WHAT HAPPENED", STUDENT_PROJECT: "THE PROJECT", ASSOCIATION: "THE ASSOCIATION", SCHOOL_NEWS: "IN DETAIL", STUDENT_ACHIEVEMENT: "HOW IT HAPPENED", DATA_AI_BUSINESS_INSIGHT: "WHAT IT MEANS", CAMPUS_LIFE: "ON CAMPUS", ALUMNI: "THE JOURNEY", ACADEMIC_NEWS: "IN DETAIL", CAREER_INTERNSHIP: "IN DETAIL" };
    const budget = targetWords * 1.25;
    let words = 0;
    let crossheadDone = storyType === "ANECDOTE" || storyType === "PHOTO_STORY";
    for (const [idx, sub] of ordered.entries()) {
      const sentences = splitSentences(proseOf(sub));
      const fp = sentences.filter(isFirstPerson);
      const asTestimony = idx > 0 && fp.length >= 2 && fp.length >= sentences.length * 0.6;
      for (const [pIdx, p] of groupIntoParagraphs(sentences).entries()) {
        if (words > budget) break;
        if (!crossheadDone && pIdx === 1 && idx === 0) {
          blocks.push({ type: "crosshead", text: crossheadByType[storyType] ?? "IN DETAIL" });
          crossheadDone = true;
        }
        blocks.push(asTestimony ? testimony(p, sub.contributor ?? null) : paragraph(p));
        words += wordCount(p);
      }
    }
    if (whyItMatters && words < budget) {
      blocks.push({ type: "crosshead", text: "WHY IT MATTERS" });
      blocks.push(paragraph(whyItMatters));
    }
    if (storyType === "PHOTO_STORY") cautions.push("Photo story: the captions carry the content, keep the text short.");
  }

  // Quotes with a known speaker become testimony blocks when the text does not already contain them.
  const bodyText = blocks.map((b) => ("text" in b && b.text ? b.text : b.type === "qa" ? b.answer : "")).join("\n");
  for (const q of quotes) {
    if (!q.speaker || usedQuoteIds.has(q.id)) continue;
    if (containment(q.text, bodyText) >= 0.9) continue;
    blocks.push({ type: "testimony", quoteId: q.id, text: null, speaker: null, factIds: [] });
    usedQuoteIds.add(q.id);
  }

  // "In a nutshell": short labelled facts first (Company, Cohort, Results…), then short prose facts.
  const isLabelled = (f: FactRef) => /^[A-Z][A-Za-z ]{1,30}: /.test(f.statement);
  const shortFacts = usable.filter((f) => f.statement.length <= 100 && !/^People involved:|^Organisations:/i.test(f.statement));
  const boxFacts = [...shortFacts.filter(isLabelled), ...shortFacts.filter((f) => !isLabelled(f) && f.category !== "other")].slice(0, 6);
  if (boxFacts.length >= 3) {
    blocks.push({ type: "box", title: "In a nutshell", items: boxFacts.map((f) => f.statement.replace(/\.$/, "")), factIds: boxFacts.map((f) => f.id) });
    boxFacts.forEach((f) => cited.add(f.id));
  }

  if (!blocks.length && primary) blocks.push(paragraph(firstSentences(proseOf(primary), 4)));
  const disputed = allFacts.filter((f) => f.confidence === "CONFLICTING" || f.status === "DISPUTED");
  if (disputed.length) cautions.push(`${disputed.length} disputed fact(s) were not used: ${disputed.map((f) => truncateChars(f.statement, 80)).join(" | ")}`);
  const total = blocks.reduce((n, b) => n + wordCount("text" in b && b.text ? b.text : b.type === "qa" ? `${b.question} ${b.answer}` : b.type === "list" || b.type === "box" ? b.items.join(" ") : ""), 0);
  if (total > targetWords * 1.5) cautions.push(`Draft is about ${total} words for a ${targetWords}-word target: consider shortening.`);
  if (total < targetWords * 0.4) cautions.push(`Draft is short (about ${total} words for a ${targetWords}-word target): the sources may need more material.`);
  const unusedFacts = usable.filter((f) => !cited.has(f.id)).map((f) => f.id);
  return { blocks, unusedFacts, cautions };
}

// ─── headline generator ──────────────────────────────────────────────────────

function headlineFrom(text: string): string {
  const cleaned = text
    .replace(/^(?:[A-Z][a-z ]+):\s+/, "")
    .replace(/[.!]+$/, "")
    .trim();
  if (cleaned.length <= 70) return cleaned;
  // Prefer cutting at a clause boundary so the headline stays a complete phrase.
  const window = cleaned.slice(0, 71);
  let best = -1;
  for (const m of window.matchAll(/,\s|;\s|:\s|\s[—–-]\s|\swhile\s|\sand\s/g)) if ((m.index ?? 0) >= 25) best = m.index ?? -1;
  if (best > 0) return cleaned.slice(0, best).trim();
  return truncateChars(cleaned, 70);
}

function localHeadlineGenerator(input: Input) {
  const storyType = str(input, "storyType");
  const title = str(input, "title");
  const facts = arr<FactRef>(input, "factList");
  const count = Math.max(1, num(input, "count", 5));
  const company = str(input, "company");
  const cohort = str(input, "cohort");
  const current = str(input, "currentHeadline");
  const out: { text: string; angle: string }[] = [];
  const push = (text: string | null | undefined, angle: string) => {
    if (!text) return;
    const t = headlineFrom(text);
    if (t.length < 8 || out.some((o) => o.text.toLowerCase() === t.toLowerCase())) return;
    out.push({ text: t, angle });
  };
  push(title, "working title");
  if (storyType === "BUSINESS_DEEP_DIVE" && company) push(cohort ? `${company} – ${cohort}` : `${company} – Business Deep Dive`, "company and cohort");
  const byCategory = (cat: string) => facts.find((f) => f.category === cat && !/^The name is spelled/.test(f.statement) && !/^[A-Z][a-z ]+:/.test(f.statement));
  push(byCategory("metric")?.statement, "key result");
  push(byCategory("award")?.statement, "the winners");
  push(byCategory("result")?.statement, "the solution");
  push(byCategory("date")?.statement, "the date");
  if (current && current !== title) push(current, "current headline");
  if (company) {
    const metric = byCategory("metric");
    if (metric) push(`${company}: ${headlineFrom(metric.statement)}`, "company and result");
  }
  for (const f of facts) {
    if (out.length >= count) break;
    if (/^The name is spelled/.test(f.statement)) continue;
    push(f.statement, `from a ${f.category ?? "fact"} in the sources`);
  }
  return { headlines: out.slice(0, count) };
}

// ─── standfirst ──────────────────────────────────────────────────────────────

function localStandfirst(input: Input) {
  const headline = normalizeName(str(input, "headline"));
  const sentences = splitSentences(str(input, "body")).filter((s) => normalizeName(s) !== headline && !isUpperCase(s) && wordCount(s) >= 4);
  const first = sentences[0] ?? "";
  const second = sentences[1] ?? "";
  const combined = first && second && wordCount(first) + wordCount(second) <= 35 ? `${first} ${second}` : first;
  return { standfirst: truncateWords(combined, 35) };
}

// ─── pull quote ──────────────────────────────────────────────────────────────

function localPullQuote(input: Input) {
  const quotes = arr<QuoteRef>(input, "quoteList");
  if (!quotes.length) return { quoteId: null, text: null, reason: "No quotes available." };
  const fits = quotes.filter((q) => q.text.length <= 140);
  const withSpeaker = fits.filter((q) => q.speaker);
  const pool = withSpeaker.length ? withSpeaker : fits;
  if (pool.length) {
    const best = [...pool].sort((a, b) => b.text.length - a.text.length)[0];
    return { quoteId: best.id, text: best.text, reason: best.speaker ? `Longest quote under 140 characters with a named speaker (${best.speaker}).` : "Longest quote under 140 characters (no speaker named)." };
  }
  const best = [...quotes].sort((a, b) => Number(!!b.speaker) - Number(!!a.speaker) || a.text.length - b.text.length)[0];
  return { quoteId: best.id, text: truncateChars(best.text, 140), reason: "All quotes exceed 140 characters; the shortest attributed one was trimmed." };
}

// ─── caption ─────────────────────────────────────────────────────────────────

function localCaption(input: Input) {
  const contributor = cleanText(str(input, "contributorCaption"));
  const title = cleanText(str(input, "storyTitle"));
  const photographer = cleanText(str(input, "photographer"));
  const caption = truncateChars(contributor || title || "Photo", 120);
  return { caption, credit: photographer ? `© ${photographer}` : null };
}

// ─── copy editor ─────────────────────────────────────────────────────────────

function normaliseBlockText(block: AiBlock): { block: AiBlock; changed: boolean } {
  const fix = (t: string) => normalizeTypography(cleanText(t));
  switch (block.type) {
    case "paragraph":
    case "crosshead":
    case "pullquote":
    case "testimony": {
      const text = fix(block.text);
      return { block: { ...block, text }, changed: text !== block.text };
    }
    case "qa": {
      const question = fix(block.question);
      const answer = fix(block.answer);
      return { block: { ...block, question, answer }, changed: question !== block.question || answer !== block.answer };
    }
    case "list": {
      const items = block.items.map(fix);
      return { block: { ...block, items }, changed: items.some((it, i) => it !== block.items[i]) };
    }
    case "box": {
      const items = block.items.map(fix);
      const text = block.text ? fix(block.text) : block.text;
      return { block: { ...block, items, text }, changed: items.some((it, i) => it !== block.items[i]) || text !== block.text };
    }
    default:
      return { block, changed: false };
  }
}

function blockWords(block: AiBlock): number {
  switch (block.type) {
    case "paragraph":
    case "crosshead":
    case "pullquote":
    case "testimony":
      return wordCount(block.text);
    case "qa":
      return wordCount(`${block.question} ${block.answer}`);
    case "list":
    case "box":
      return wordCount(block.items.join(" "));
    default:
      return 0;
  }
}

function localCopyEditor(input: Input) {
  const instruction = str(input, "instruction");
  const targetWords = num(input, "targetWords");
  const changes: string[] = [];
  let blocks = arr<AiBlock>(input, "blockList").map((b) => {
    const { block, changed } = normaliseBlockText(b);
    if (changed) changes.push(`${b.id}: normalised whitespace, punctuation and quotation marks.`);
    return block;
  });
  if (/\b(shorten|cut|trim|reduce|tighten)\b/i.test(instruction) && targetWords > 0) {
    let total = blocks.reduce((n, b) => n + blockWords(b), 0);
    let guard = 0;
    while (total > targetWords && guard < 30) {
      guard += 1;
      const candidates = blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.type === "paragraph" && splitSentences(b.text).length > 1);
      if (!candidates.length) break;
      const longest = candidates.sort((x, y) => wordCount((y.b as { text: string }).text) - wordCount((x.b as { text: string }).text))[0];
      const sentences = splitSentences((longest.b as { text: string }).text);
      const removed = sentences.pop()!;
      const text = sentences.join(" ");
      blocks = blocks.map((b, i) => (i === longest.i ? ({ ...b, text } as AiBlock) : b));
      changes.push(`${longest.b.id}: removed the sentence “${truncateChars(removed, 60)}” to reach ${targetWords} words.`);
      total -= wordCount(removed);
    }
  }
  if (/\bstructure\b/i.test(instruction)) {
    blocks = blocks.map((b) => (b.type === "crosshead" && !isUpperCase(b.text) ? (changes.push(`${b.id}: capitalised crosshead.`), { ...b, text: b.text.toUpperCase() }) : b));
  }
  if (!changes.length) changes.push("No changes needed: the text already follows the house style rules checked by the local provider.");
  return { blocks, changes };
}

// ─── consistency checker ─────────────────────────────────────────────────────

type BlockLike = { id: string; type: string } & Partial<{ text: string; question: string; answer: string; items: string[]; title: string | null; caption: string | null }>;

function blockLikeText(b: BlockLike): string {
  if (b.type === "qa") return `${b.question ?? ""} ${b.answer ?? ""}`.trim();
  if (b.type === "list") return (b.items ?? []).join(" ");
  if (b.type === "box") return [b.title, b.text, ...(b.items ?? [])].filter(Boolean).join(" ");
  if (b.type === "image") return b.caption ?? "";
  return b.text ?? "";
}

function localConsistencyChecker(input: Input) {
  const facts = arr<FactRef>(input, "factList");
  const quotes = arr<QuoteRef>(input, "quoteList");
  const blocks = arr<BlockLike>(input, "blockList");
  const sourceText = [...facts.map((f) => f.statement), ...quotes.map((q) => q.text)].join("\n");
  const sourceNames = uniq(nameSet(sourceText));
  const sourceNameKeys = new Set(sourceNames.map((n) => n.toLowerCase()));
  const sourceNumbers = new Set(extractNumbers(sourceText));
  const issues: { blockId: string; excerpt: string; type: "UNSUPPORTED" | "CONTRADICTION" | "NAME_MISMATCH" | "NUMBER_MISMATCH" | "QUOTE_ALTERED"; explanation: string; severity: "info" | "warning" | "error" }[] = [];
  const hasSources = facts.length > 0 || quotes.length > 0;

  for (const block of blocks) {
    if (block.type === "crosshead" || block.type === "divider" || block.type === "image") continue;
    const text = blockLikeText(block);
    if (!text) continue;
    const sentences = splitSentences(text);
    for (const name of uniq(nameSet(text))) {
      const exact = sourceNameKeys.has(name.toLowerCase());
      const near = sourceNames.find((s) => s.toLowerCase() !== name.toLowerCase() && (nearIdenticalNames(name, s) || (name.split(" ").length === s.split(" ").length && name.split(" ").every((w, i) => w.toLowerCase() === s.split(" ")[i]?.toLowerCase() || nearIdenticalNames(w, s.split(" ")[i] ?? "")))));
      if (!near) continue;
      const excerpt = truncateChars(sentences.find((s) => s.includes(name)) ?? name, 120);
      issues.push({ blockId: block.id, excerpt, type: "NAME_MISMATCH", explanation: exact ? `The sources spell this name both “${name}” and “${near}”: confirm the spelling used in the article.` : `“${name}” in the article vs “${near}” in the sources.`, severity: "warning" });
    }
    if (hasSources) {
      for (const n of extractNumbers(text)) {
        if (sourceNumbers.has(n)) continue;
        if (!/[%.,]/.test(n) && n.replace(/[^\d]/g, "").length < 2) continue;
        issues.push({ blockId: block.id, excerpt: truncateChars(sentences.find((s) => s.includes(n)) ?? n, 120), type: "NUMBER_MISMATCH", explanation: `The number ${n} does not appear in the fact sheet or quotes.`, severity: "warning" });
      }
    }
    if (block.type === "pullquote" || block.type === "testimony") {
      const key = normalizeName(text);
      const exact = quotes.some((q) => normalizeName(q.text) === key || normalizeName(q.text).includes(key) || key.includes(normalizeName(q.text)));
      // A quotation must match a *quote*: a fact that says the same thing is a paraphrase, not a
      // verbatim source, so it never excuses altered wording. Facts only help when no quote exists.
      const supported = quotes.length === 0 && facts.some((f) => sentenceOverlap(f.statement, text) >= 0.5 || containment(f.statement, text) >= 0.8);
      if (!exact && !supported && quotes.length) {
        const closest = quotes.map((q) => ({ q, s: textSimilarity(q.text, text) })).sort((a, b) => b.s - a.s)[0];
        if (closest && closest.s >= 0.5) issues.push({ blockId: block.id, excerpt: truncateChars(text, 120), type: "QUOTE_ALTERED", explanation: `The quotation differs from the source quote “${truncateChars(closest.q.text, 80)}”.`, severity: "warning" });
      }
      continue;
    }
    if (hasSources && (block.type === "paragraph" || block.type === "qa" || block.type === "list" || block.type === "box")) {
      for (const s of sentences) {
        if (wordCount(s) < 6) continue;
        const best = Math.max(0, ...facts.map((f) => Math.max(sentenceOverlap(s, f.statement), containment(s, f.statement))), ...quotes.map((q) => containment(s, q.text)));
        // A sentence built from the sources scores close to 1; incidental overlap on a few common
        // words ("the winning team…") sits around 0.25, so 0.35 separates support from coincidence.
        if (best < 0.35) issues.push({ blockId: block.id, excerpt: truncateChars(s, 120), type: "UNSUPPORTED", explanation: "No fact or quote in the sources supports this sentence.", severity: "info" });
      }
    }
  }
  const errors = issues.filter((i) => i.severity !== "info").length;
  const verdict = issues.length ? `${issues.length} issue(s) found (${errors} to check before publication).` : "No inconsistencies found against the fact sheet.";
  return { issues, verdict };
}

// ─── tone harmonizer ─────────────────────────────────────────────────────────

function localToneHarmonizer(input: Input) {
  const changes: string[] = [];
  const blocks = arr<AiBlock>(input, "blockList").map((b) => {
    if (b.type === "crosshead") {
      const text = b.text.toUpperCase();
      if (text !== b.text) changes.push(`${b.id}: crosshead set in capitals.`);
      return { ...b, text };
    }
    const british = (t: string) => {
      const r = toBritishSpelling(t);
      if (r.changes.length) changes.push(`${b.id}: British spelling (${r.changes.join(", ")}).`);
      return r.text;
    };
    switch (b.type) {
      case "paragraph":
      case "pullquote":
      case "testimony":
        return { ...b, text: british(b.text) };
      case "qa":
        return { ...b, question: isUpperCase(b.question) ? b.question : (changes.push(`${b.id}: question set in capitals.`), b.question.toUpperCase()), answer: british(b.answer) };
      case "list":
        return { ...b, items: b.items.map(british) };
      case "box":
        return { ...b, items: b.items.map(british), text: b.text ? british(b.text) : b.text };
      default:
        return b;
    }
  });
  if (!changes.length) changes.push("Tone already consistent: capitalised crossheads and British spelling.");
  return { blocks, changes };
}

// ─── section planner ─────────────────────────────────────────────────────────

type PlannerStoryLike = { id: string; title: string; storyType: string; campuses: string[]; score: number; words: number; photos: number; hasHero: boolean; targetLength: string; currentSectionSlug?: string | null };

function localSectionPlanner(input: Input) {
  const sections = arr<{ slug: string; name: string }>(input, "sectionList");
  const slugs = sections.map((s) => s.slug);
  const stories = arr<PlannerStoryLike>(input, "storyList");
  const fallback = slugs.includes("campus-life") ? "campus-life" : (slugs.find((s) => !["cover", "this-month", "back-page"].includes(s)) ?? slugs[0] ?? "campus-life");
  const assigned = stories.map((s) => {
    const preferred = defaultSectionForStoryType(s.storyType);
    const sectionSlug = slugs.includes(preferred) ? preferred : s.currentSectionSlug && slugs.includes(s.currentSectionSlug) ? s.currentSectionSlug : fallback;
    return { story: s, sectionSlug };
  });
  const bySection = new Map<string, typeof assigned>();
  for (const a of assigned) bySection.set(a.sectionSlug, [...(bySection.get(a.sectionSlug) ?? []), a]);
  const planned: { storyId: string; sectionSlug: string; order: number; template: string; pages: number }[] = [];
  for (const [slug, list] of bySection) {
    list.sort((a, b) => b.story.score - a.story.score || a.story.id.localeCompare(b.story.id)).forEach((a, i) => {
      planned.push({ storyId: a.story.id, sectionSlug: slug, order: i + 1, template: defaultTemplateForStoryType(a.story.storyType, { mediaCount: a.story.photos, wordCount: a.story.words, targetLength: a.story.targetLength }), pages: a.story.targetLength === "FEATURE" ? 2 : 1 });
    });
  }
  const coverCandidates = stories.filter((s) => s.hasHero);
  const cover = [...(coverCandidates.length ? coverCandidates : stories)].sort((a, b) => b.score + b.photos * 5 - (a.score + a.photos * 5) || a.id.localeCompare(b.id))[0] ?? null;
  const spotlight = stories
    .filter((s) => ["INTERVIEW_PROFILE", "STUDENT_ACHIEVEMENT", "STUDENT_PROJECT"].includes(s.storyType) && s.id !== cover?.id)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 3)
    .map((s) => s.id);
  const rationale = `Rule-based plan: ${stories.length} stories placed in ${bySection.size} section(s) by story type, ordered by editorial score; cover = the highest-scoring story with a hero image${cover ? ` (${truncateChars(cover.title, 40)})` : ""}.`;
  return { stories: planned, coverStoryId: cover?.id ?? null, spotlightStoryIds: spotlight, rationale };
}

// ─── cover selector ──────────────────────────────────────────────────────────

type CoverStoryLike = { id: string; headline: string; standfirst: string | null; storyType: string; photos: number; score: number; hasHero: boolean; visualRichness: number };

function localCoverSelector(input: Input) {
  const stories = arr<CoverStoryLike>(input, "storyList");
  if (!stories.length) return { coverStoryId: null, coverHeadline: "", coverStandfirst: "", teasers: [] };
  const withHero = stories.filter((s) => s.hasHero);
  const pool = withHero.length ? withHero : stories.filter((s) => s.photos > 0).length ? stories.filter((s) => s.photos > 0) : stories;
  const cover = [...pool].sort((a, b) => b.score + b.visualRichness - (a.score + a.visualRichness) || a.id.localeCompare(b.id))[0];
  const teasers = stories
    .filter((s) => s.id !== cover.id)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 5)
    .map((s) => ({ storyId: s.id, line: truncateChars(s.headline, 45) }));
  return { coverStoryId: cover.id, coverHeadline: truncateChars(cover.headline, 60), coverStandfirst: truncateWords(cover.standfirst ?? "", 25), teasers };
}

// ─── table of contents ───────────────────────────────────────────────────────

function localToc(input: Input) {
  const articles = arr<{ id: string; section: string; headline: string; standfirst: string | null }>(input, "articleList");
  return { lines: articles.map((a) => ({ articleId: a.id, text: truncateChars(a.headline || a.standfirst || "", 60) })) };
}

// ─── edition QA ──────────────────────────────────────────────────────────────

type QaArticleLike = { id: string; headline: string; standfirst: string | null; section: string; text: string; captionsMissing: number; imageCount: number };

function localEditionQa(input: Input) {
  const articles = arr<QaArticleLike>(input, "articleList");
  const campuses = arr<string>(input, "campuses");
  const issues: { code: string; severity: "info" | "warning" | "error"; message: string; articleId: string | null }[] = [];
  const headlines = new Map<string, string[]>();
  for (const a of articles) {
    if (a.headline.length > 70) issues.push({ code: "HEADLINE_TOO_LONG", severity: "warning", message: `Headline is ${a.headline.length} characters (max 70): “${truncateChars(a.headline, 60)}”.`, articleId: a.id });
    if (!a.standfirst || !a.standfirst.trim()) issues.push({ code: "STANDFIRST_MISSING", severity: "warning", message: "The article has no standfirst.", articleId: a.id });
    else if (normalizeName(a.standfirst) === normalizeName(a.headline)) issues.push({ code: "STANDFIRST_REPEATS_HEADLINE", severity: "warning", message: "The standfirst repeats the headline.", articleId: a.id });
    if (a.captionsMissing > 0) issues.push({ code: "MISSING_CAPTIONS", severity: "warning", message: `${a.captionsMissing} image(s) without a caption.`, articleId: a.id });
    const key = normalizeName(a.headline);
    if (key) headlines.set(key, [...(headlines.get(key) ?? []), a.id]);
  }
  for (const [, ids] of headlines) {
    if (ids.length > 1) issues.push({ code: "DUPLICATE_HEADLINE", severity: "error", message: `The same headline is used by ${ids.length} articles (${ids.join(", ")}).`, articleId: ids[0] });
  }
  const corpus = articles.map((a) => `${a.headline} ${a.standfirst ?? ""} ${a.text}`.toLowerCase()).join("\n");
  for (const campus of campuses) {
    if (!corpus.includes(campus.toLowerCase())) issues.push({ code: "CAMPUS_NOT_MENTIONED", severity: "info", message: `The ${campus} campus is never mentioned in this edition.`, articleId: null });
  }
  const assessment = issues.length ? `${issues.length} issue(s) found across ${articles.length} article(s) by the rule-based checks.` : `No issues found across ${articles.length} article(s) by the rule-based checks.`;
  return { issues, assessment };
}

// ─── external news ───────────────────────────────────────────────────────────

function localExternalNews(input: Input) {
  const sources = arr<{ url: string; title: string; text: string }>(input, "sourceList");
  const notes = str(input, "notes");
  const title = sources[0]?.title ? truncateChars(sources[0].title, 70) : `Business & Data: ${sources.length} item(s)`;
  const paragraphs = sources.slice(0, 3).map((s) => firstSentences(s.text, 2)).filter(Boolean);
  const whyItMatters = notes || (sources[0] ? splitSentences(sources[0].text).slice(-1)[0] ?? "" : "");
  return { title, paragraphs, whyItMatters, sourceUrls: sources.map((s) => s.url).filter(Boolean) };
}

// ─── translator ──────────────────────────────────────────────────────────────

function localTranslator(input: Input) {
  return { blocks: arr<AiBlock>(input, "blockList"), notes: [`local provider does not translate (target language: ${str(input, "targetLanguage") || "unknown"}); blocks returned unchanged.`] };
}

// ─── image describer ─────────────────────────────────────────────────────────

function localImageDescriber(input: Input) {
  const fileName = str(input, "fileName");
  const caption = cleanText(str(input, "caption"));
  const context = cleanText(str(input, "context"));
  const lower = fileName.toLowerCase();
  const kind = /logo/.test(lower) ? "logo" : /screenshot|dashboard|screen/.test(lower) ? "screenshot" : /diagram|schema|flow/.test(lower) ? "diagram" : /chart|graph|plot/.test(lower) ? "chart" : /\.pdf$|document|scan/.test(lower) ? "document" : "photo";
  const width = num(input, "width");
  const height = num(input, "height");
  const nameTokens = lower.replace(/\.[a-z0-9]+$/, "").split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !/^\d+$/.test(t));
  const description = caption ? `${kind === "photo" ? "Photo" : kind.charAt(0).toUpperCase() + kind.slice(1)}: ${caption}` : `${kind.charAt(0).toUpperCase() + kind.slice(1)} from file ${fileName}${width && height ? ` (${width}×${height})` : ""}${context ? `, related to ${context}` : ""}.`;
  const tags = uniq([kind, ...nameTokens, ...contentTokens(context).slice(0, 3)]).slice(0, 6);
  return { description: truncateChars(description, 200), tags, kind };
}


/**
 * The Art Director, without a model.
 *
 * Builds the same brief `localBrief` would, from the prompt variables the service passed down. It
 * exists so the local provider answers every service rather than most of them: a development install
 * or a workspace with no OpenAI key gets a real carousel, not a gap.
 *
 * Parsing the material back out of the formatted prompt string is not elegant, and it is the right
 * trade: the alternative is a second path into the composer that can drift from the first.
 */
function localArtDirector(input: Input): unknown {
  const stories = str(input, "stories");
  const lines = stories.split("\n").filter(Boolean);
  const headlines = lines
    .filter((line) => line.startsWith("— Story"))
    .map((line) => line.replace(/^— Story \d+ \(id [^)]*\): /, "").trim())
    .filter(Boolean);
  const standfirst = lines.find((line) => line.startsWith("Standfirst: "))?.slice(12) ?? null;
  const quoteLine = lines.find((line) => line.startsWith('Quote: "'));
  const organizationName = str(input, "organizationName") || "We";
  const minFrames = Math.max(1, Number(input.minFrames) || 3);
  const maxFrames = Math.max(minFrames, Number(input.maxFrames) || 10);

  const lead = headlines[0] ?? organizationName;
  // Over the organisation's own photograph when one was offered and the mode allows it. The id is
  // taken from the offer as written, never invented: the same property the real Art Director is
  // held to, and the reason a pack made without a model can still open on a real picture.
  const photograph = input.mayUseOwnPhotographs === true ? parseOfferedMedia(str(input, "media"))[0] : undefined;
  const frames: Record<string, unknown>[] = [
    photograph
      ? { layout: "image_full", headline: lead.slice(0, 180), surface: "ink", emphasis: "loud", mediaId: photograph.id, alt: photograph.description.slice(0, 280) }
      : { layout: "statement", headline: lead.slice(0, 180), surface: "brand", emphasis: "loud" },
  ];
  if (standfirst) frames.push({ layout: "heading_body", headline: "What happened", body: standfirst.slice(0, 420), surface: "paper", emphasis: "normal" });
  const figure = lines.find((line) => line.startsWith("Figures worth showing: "))?.slice(23).split(",")[0]?.trim();
  if (figure) frames.push({ layout: "figure", headline: lead.slice(0, 90), figure: figure.slice(0, 24), surface: "ink", emphasis: "loud" });
  if (quoteLine) {
    const match = /^Quote: "(.+)" — (.+)$/.exec(quoteLine);
    if (match) frames.push({ layout: "quote", headline: match[1].slice(0, 180), attribution: match[2].slice(0, 180), surface: "muted", emphasis: "normal" });
  }
  const others = headlines.slice(1, 6);
  if (others.length >= 2) frames.push({ layout: "list", headline: "Also this month", items: others.map((item) => item.slice(0, 180)), surface: "paper", emphasis: "quiet" });
  frames.push({ layout: "cta", headline: "Read the whole thing", body: `The full edition from ${organizationName}.`, surface: "accent", emphasis: "normal" });

  while (frames.length < minFrames) frames.push({ layout: "statement", headline: organizationName, surface: "ink", emphasis: "normal" });
  // Trim from the middle, never from the end: the close is the one frame that tells a reader what
  // to do next, and the evidence between opener and close is what a set can afford to lose.
  const trimmed = frames.length > maxFrames ? [...frames.slice(0, maxFrames - 1), frames[frames.length - 1]] : frames;

  return {
    format: str(input, "format") || "CAROUSEL",
    mode: str(input, "mode") || "STUDIO",
    intent: standfirst ?? lead,
    frames: trimmed,
    caption: [lead, standfirst, `— ${organizationName}`].filter(Boolean).join("\n\n").slice(0, 2200),
    hashtags: [],
  };
}

/** One offered picture per line, "id: description (orientation)", as the prompt lays them out. */
const OFFERED_MEDIA_LINE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}): (.+?)(?: \(([^()]*)\))?$/i;

function parseOfferedMedia(text: string): { id: string; description: string }[] {
  return text.split("\n").flatMap((line) => {
    const match = OFFERED_MEDIA_LINE.exec(line.trim());
    return match ? [{ id: match[1], description: match[2].trim() }] : [];
  });
}

// ─── Speech ──────────────────────────────────────────────────────────────────

/**
 * Without a model, the words are read as written: the deterministic pass that follows says the
 * numbers and the initialisms, and nothing is condensed. Passages come back one for one, in order,
 * which is the contract the adapter checks a real model against too.
 */
function localSpeechAdapter(input: Input): unknown {
  const passages = arr<{ index: number; text: string }>(input, "passagesJson");
  return { language: str(input, "language") || "en", passages: passages.map((passage) => ({ index: passage.index, text: passage.text, tag: null })) };
}

function localVoiceDirector(input: Input): unknown {
  return { stance: str(input, "baseStance"), energy: str(input, "baseEnergy") || "medium", pauses: str(input, "basePauses") || "natural", tags: [] };
}

// ─── Pictures ────────────────────────────────────────────────────────────────

/** Without a model the rules' own plan stands: the caller reconciles this with the same floor it computed. */
function localImagePlanner(input: Input): unknown {
  const floor = obj(input, "floor");
  const instruction = str(input, "instruction");
  return {
    operation: str(floor, "operation") || (str(input, "mode").startsWith("edit") ? "global_edit" : "generate"),
    task: str(floor, "task") || "realistic_scene",
    change: [instruction],
    preserve: arr<string>(floor, "preserve"),
    references: [],
    sensitivity: str(floor, "sensitivity") || "LOW",
    region: null,
    output: "raster",
    prompt: "",
  };
}

/**
 * The studio with no model behind it.
 *
 * Every other local generator here is a fixture that stands in for a writing task, and that is
 * fair: rearranging sentences deterministically produces something of the right shape to test with.
 * Understanding is not that kind of task. "Elle est beaucoup trop dense, ça donne pas envie de
 * lire" is a request to make the issue shorter; no list of keywords gets there, and one that
 * matched on "dense" would be guessing — then acting on the guess, against somebody's issue,
 * spending one of their revisions.
 *
 * So this one refuses. It still says everything it actually knows, because the snapshot is measured
 * rather than inferred and those numbers are useful on their own, and it names what is missing so
 * the fix is one click away instead of a mystery. An honest "I cannot read that" is worth more than
 * a confident wrong operation.
 */
function localEditionStudio(input: Input): unknown {
  const snapshot = str(input, "snapshot");
  const attached = str(input, "attachedMedia");
  const pageLines = snapshot.split("\n").filter((l) => /^[0-9a-f-]{36} · p\d+/.test(l));
  const pages = Number(snapshot.match(/currently (\d+) pages/)?.[1] ?? pageLines.length);
  const words = Number(snapshot.match(/ · (\d+) words/)?.[1] ?? 0);
  const emptiest = pageLines
    .filter((l) => !l.includes("FURNITURE") && !l.includes("LOCKED") && l.includes("[story "))
    .map((l) => ({ number: Number(l.match(/ · p(\d+) · /)?.[1] ?? 0), fill: Number(l.match(/ · (\d+)% · /)?.[1] ?? 100) }))
    .sort((a, b) => a.fill - b.fill)[0];
  const attachedCount = attached.split("\n").filter((l) => /^[0-9a-f-]{36}/.test(l)).length;

  const facts = [
    `The issue is ${pages} pages${words ? ` and ${words} words` : ""}.`,
    emptiest ? `The emptiest page carrying a story is page ${emptiest.number}, ${emptiest.fill}% full.` : null,
    attachedCount ? `${attachedCount} photograph(s) came in with your message and are waiting.` : null,
  ].filter(Boolean);

  return {
    reply: `${facts.join(" ")} I can't read what you asked for: no language model is connected to this workspace, and I won't guess at your words and then act on the guess. Connect one under Platform → Integrations and ask me again. Nothing else is blocked: anything already on the list applies from the button beside it, and the flatplan and the article desk still edit the issue by hand.`,
    operations: [],
    askFirst: false,
    // Never from here. Reading "applique" out of a sentence is the same guess as reading "shorter"
    // out of one, and this one would spend somebody's revision.
    apply: false,
  };
}
