import { blockText, type DocumentArticle, type DocumentMedia, type EditionDocument } from "@/lib/publication/document";
import { IMPORTANCE_WEIGHT, type Importance } from "./roles";

/**
 * What this edition actually is, read off the edition itself.
 *
 * §78 of the design brief: before laying anything out, identify the dominant story, the tone, what
 * imagery exists, how the content balances, how much data, how many people, how many events — and
 * only then decide the art direction. This is that reading, and it is deliberately arithmetic
 * rather than clever: a model may add judgement on top, but the numbers underneath it are the same
 * every time, so a design can be explained and reproduced.
 *
 * Everything here is measured from the `EditionDocument`. Nothing is asked of a person and nothing
 * is invented.
 */

export type StorySignal = {
  articleId: string;
  storyId: string;
  sectionId: string | null;
  headline: string;
  words: number;
  /** Pictures attached to this story that could actually be printed. */
  usablePictures: number;
  /** Its best picture, by rights, resolution and role. */
  bestPictureId: string | null;
  /** Whether a portrait — a person — is among them. */
  hasPortrait: boolean;
  quotes: number;
  /** Numbers worth setting large: facts and metrics the story carries. */
  figures: number;
  hasEvent: boolean;
  hasTable: boolean;
  isCover: boolean;
  /** 0–1, from everything above. The ranking that becomes editorial importance. */
  weight: number;
  /** Why it ranks where it does, in one line. */
  because: string;
};

export type EditionSignals = {
  stories: StorySignal[];
  sections: { id: string; name: string; stories: number; words: number }[];
  counts: {
    stories: number;
    words: number;
    pictures: number;
    usablePictures: number;
    portraits: number;
    quotes: number;
    figures: number;
    events: number;
    tables: number;
  };
  /** Usable pictures per story. Below ~0.4 an edition cannot be photography-led however it feels. */
  picturesPerStory: number;
  /** 0–1: how much of this edition is numbers rather than prose. */
  dataDensity: number;
  /** 0–1: how much of it is about named people. */
  peopleDensity: number;
  /** Words in the longest story over words in the median one: how uneven the material is. */
  spread: number;
  /** The story the edition is about, if one stands out. */
  dominant: StorySignal | null;
  /** Whether anything stands out at all — twenty equal briefs have no lead, and should not pretend. */
  hasLead: boolean;
  longest: StorySignal | null;
  shortest: StorySignal | null;
};

/** A picture worth placing: cleared for use, and big enough to be printed. */
export function isUsable(media: DocumentMedia): boolean {
  if (media.rightsStatus === "RED") return false;
  const width = media.src.print?.width ?? media.width ?? 0;
  return width >= 900;
}

function figuresIn(article: DocumentArticle): number {
  const facts = article.facts?.length ?? 0;
  const metrics = article.bdd?.metrics.length ?? 0;
  // A number in prose is not a figure worth setting large unless it is a real quantity.
  const inText = article.body.filter((b) => /\b\d[\d.,]*\s*(%|per cent|million|bn|k€|€|\$|£)\b/i.test(blockText(b))).length;
  return facts + metrics + Math.min(inText, 4);
}

export function readSignals(doc: EditionDocument): EditionSignals {
  const media = new Map(doc.media.map((m) => [m.id, m]));
  const usable = doc.media.filter(isUsable);
  const coverArticleId = doc.meta.cover.articleId;

  const stories: StorySignal[] = doc.articles.map((article) => {
    const attached = article.media.map((m) => media.get(m.mediaId)).filter((m): m is DocumentMedia => Boolean(m));
    const hero = article.heroMediaId ? media.get(article.heroMediaId) : undefined;
    const pictures = [...(hero ? [hero] : []), ...attached].filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i);
    const usableHere = pictures.filter(isUsable);
    const best = usableHere.slice().sort((a, b) => (b.src.print?.width ?? b.width ?? 0) - (a.src.print?.width ?? a.width ?? 0))[0] ?? null;
    const quotes = article.pullQuotes.length + article.body.filter((b) => b.type === "pullquote" || b.type === "testimony").length;
    const figures = figuresIn(article);
    const hasTable = Boolean(article.bdd) || article.body.some((b) => b.type === "box" && (b.items?.length ?? 0) > 2);

    return {
      articleId: article.id,
      storyId: article.storyId,
      sectionId: article.sectionId,
      headline: article.headline,
      words: article.wordCount,
      usablePictures: usableHere.length,
      bestPictureId: best?.id ?? null,
      hasPortrait: usableHere.some((m) => m.kind === "PORTRAIT" || (m.aspectRatio ?? 1.5) < 1),
      quotes,
      figures,
      hasEvent: Boolean(article.event) || Boolean(article.eventDateText),
      hasTable,
      isCover: article.id === coverArticleId,
      weight: 0,
      because: "",
    };
  });

  // The ranking. Deliberately readable: length says how much there is to say, a picture says it can
  // be shown, a quote and a figure say it has something to lead with, and the pipeline's own cover
  // choice is respected rather than second-guessed.
  const maxWords = Math.max(1, ...stories.map((s) => s.words));
  for (const story of stories) {
    const length = story.words / maxWords;
    const picture = Math.min(1, story.usablePictures / 2);
    const punctuation = Math.min(1, (story.quotes + story.figures) / 4);
    const raw = 0.42 * length + 0.3 * picture + 0.18 * punctuation + (story.isCover ? 0.35 : 0);
    story.weight = Math.round(Math.min(1, raw) * 100) / 100;
    const reasons: string[] = [];
    if (story.isCover) reasons.push("chosen as the cover story");
    if (length > 0.8) reasons.push("the longest piece in the issue");
    else if (length < 0.25) reasons.push("short");
    if (story.usablePictures > 1) reasons.push(`${story.usablePictures} pictures`);
    else if (story.usablePictures === 0) reasons.push("no picture");
    if (story.figures >= 3) reasons.push("carries figures");
    if (story.quotes >= 2) reasons.push("quotable");
    story.because = reasons.join(", ") || "an ordinary piece";
  }
  stories.sort((a, b) => b.weight - a.weight || b.words - a.words);

  const words = stories.reduce((n, s) => n + s.words, 0);
  const sorted = stories.map((s) => s.words).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const figures = stories.reduce((n, s) => n + s.figures, 0);
  const portraits = stories.filter((s) => s.hasPortrait).length;

  const sections = doc.sections.map((section) => {
    const own = stories.filter((s) => s.sectionId === section.id);
    return { id: section.id, name: section.name, stories: own.length, words: own.reduce((n, s) => n + s.words, 0) };
  });

  const top = stories[0] ?? null;
  const second = stories[1] ?? null;
  // A lead is a story that is clearly ahead. Twenty equal briefs have no lead, and an edition that
  // pretends otherwise gets a hero treatment on an arbitrary piece — which reads as a mistake.
  const hasLead = Boolean(top && (!second || top.weight - second.weight >= 0.08 || top.isCover));

  return {
    stories,
    sections,
    counts: {
      stories: stories.length,
      words,
      pictures: doc.media.length,
      usablePictures: usable.length,
      portraits,
      quotes: stories.reduce((n, s) => n + s.quotes, 0),
      figures,
      events: stories.filter((s) => s.hasEvent).length,
      tables: stories.filter((s) => s.hasTable).length,
    },
    picturesPerStory: stories.length ? Math.round((usable.length / stories.length) * 100) / 100 : 0,
    dataDensity: stories.length ? Math.min(1, Math.round((figures / Math.max(1, stories.length * 2)) * 100) / 100) : 0,
    peopleDensity: stories.length ? Math.round((portraits / stories.length) * 100) / 100 : 0,
    spread: median ? Math.round((Math.max(...sorted) / median) * 100) / 100 : 1,
    dominant: hasLead ? top : null,
    hasLead,
    longest: stories.slice().sort((a, b) => b.words - a.words)[0] ?? null,
    shortest: stories.slice().sort((a, b) => a.words - b.words)[0] ?? null,
  };
}

/**
 * Shorter than this is a brief, whatever else is in the issue.
 *
 * Roughly a column of text at editorial sizes: below it there is nothing for a feature's space to
 * hold, and the page reads as two thirds empty rather than as generous.
 */
export const BRIEF_WORDS = 180;

/**
 * Editorial importance for every story, which is the thing design has to reflect.
 *
 * Proportional rather than absolute: an edition of five stories has one lead and no supporting
 * cast, and an edition of thirty has several majors and a great many briefs. Fixed thresholds would
 * make a small issue look like a big one with most of it missing. The one exception is the floor
 * below — a piece too short to fill a column cannot carry a feature's space in any issue.
 *
 * Without a clear lead nothing is promoted: every story becomes STANDARD or BRIEF by its own
 * length, because giving a hero treatment to an arbitrary piece reads as a mistake and a stack of
 * identical cards reads as no editing at all. Both are failures; only one is honest.
 */
export function assignImportance(signals: EditionSignals): Map<string, Importance> {
  const out = new Map<string, Importance>();
  const stories = signals.stories;
  if (stories.length === 0) return out;

  /*
   * What counts as short here, and what counts as short anywhere.
   *
   * The proportional half finds the short items in an issue of long ones: half the issue's average
   * length is a brief next to its neighbours. On its own it is circular — in an issue where every
   * piece is a hundred words, nothing is short, and five items that belong gathered on one page
   * were each given a feature's space with nothing to put in it.
   *
   * So there is a floor. A piece that would not fill a column is a brief in any publication, at any
   * length its neighbours happen to be.
   */
  const briefAt = Math.max(BRIEF_WORDS, Math.round((signals.counts.words / Math.max(1, stories.length)) * 0.45));

  if (!signals.hasLead) {
    for (const story of stories) out.set(story.articleId, story.words <= briefAt ? "BRIEF" : "STANDARD");
    return out;
  }

  const majors = Math.max(0, Math.min(Math.round(stories.length * 0.2), 4));
  for (const [index, story] of stories.entries()) {
    /*
     * Rank says where a story sits; the story says what it can carry.
     *
     * An eighty-word item with no picture and no figures cannot be a major piece because it came
     * second in an issue of one long article and six shorts — it would be given a major's space and
     * have nothing to put in it, which is how a page ends up two thirds empty. So rank promotes,
     * and the material caps. The one exception is the lead itself, which was chosen rather than
     * ranked.
     */
    const slight = story.words <= briefAt && story.usablePictures === 0 && story.figures < 3;
    if (index === 0) out.set(story.articleId, story.isCover ? "COVER" : "LEAD");
    else if (slight) out.set(story.articleId, "BRIEF");
    else if (index === 1 && story.weight > 0.45) out.set(story.articleId, "LEAD");
    else if (index <= majors + 1) out.set(story.articleId, "MAJOR");
    else if (story.words <= briefAt) out.set(story.articleId, "BRIEF");
    else out.set(story.articleId, "STANDARD");
  }
  return out;
}

/** The weight a story's importance carries, for the composer's arithmetic. */
export function weightOf(importance: Importance): number {
  return IMPORTANCE_WEIGHT[importance];
}

/**
 * One sentence describing the edition, in the words §78 asks for.
 *
 * Read by the director as its starting point, shown to the editor as the reason their issue looks
 * as it does, and — when no model is connected — used as the narrative itself.
 */
export function describeEdition(signals: EditionSignals): string {
  const { counts, picturesPerStory, dataDensity, peopleDensity } = signals;
  if (counts.stories === 0) return "An edition with nothing in it yet.";

  const size = counts.stories <= 6 ? "A short edition" : counts.stories >= 18 ? "A long edition" : "An edition";
  const parts: string[] = [];

  if (picturesPerStory >= 1.2) parts.push("photography-rich");
  else if (picturesPerStory < 0.4) parts.push("with almost no usable photography");
  if (peopleDensity >= 0.4) parts.push("people-heavy");
  if (dataDensity >= 0.45) parts.push("carrying a lot of figures");
  if (counts.quotes >= counts.stories) parts.push("quotable throughout");
  if (signals.spread >= 4) parts.push("very unevenly weighted");

  const shape = parts.length ? `${size}, ${parts.join(", ")}.` : `${size} of ordinary shape.`;
  const lead = signals.dominant ? ` It is about “${signals.dominant.headline}” — ${signals.dominant.because}.` : " Nothing in it stands out as the lead.";
  return `${shape}${lead}`;
}
