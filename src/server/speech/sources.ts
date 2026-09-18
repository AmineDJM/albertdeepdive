import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import type { ArticleBlock } from "@/lib/publication/document";
import { issueLabelFor } from "@/lib/publication/text";
import { planMotion } from "@/lib/creative/motion";
import type { SpeechLanguage } from "@/lib/speech/language";
import { MAX_HOLD_STRETCH, SCENE_PADDING_SECONDS } from "@/lib/speech/timing";
import type { NarrationKind } from "@/lib/speech/types";
import type { SourceBlock } from "@/lib/speech/script";

/**
 * What a narration is made from.
 *
 * The published editorial, in running order — never the raw submissions. A full edition is every
 * approved article with its own chapter; a digest is each article's standfirst; a briefing is what
 * a decision-maker would want; a film is its scenes with their timings; a custom text is itself.
 * The blocks come out typed, so an interview's answers can be given to a second voice and a
 * quotation can be said differently from the paragraph around it.
 */

export type NarrationSource = {
  title: string;
  blocks: SourceBlock[];
  /** A sample of the body, for telling the language. */
  sample: string;
  publicationId: string | null;
  publicationName: string | null;
  publicationLanguage: string | null;
  articleLanguage: string | null;
  editionLabel: string | null;
  organizationName: string;
  /** For a film: how long each scene is held before narration, by index. */
  sceneHolds: number[] | null;
};

export type SourceInput = { kind: NarrationKind; organizationId: string; editionId?: string | null; articleId?: string | null; packId?: string | null; customText?: string | null; includeUnapproved?: boolean };

type LoadedArticle = { id: string; headline: string; standfirst: string | null; body: ArticleBlock[]; language: string; storyType: string };

/** The edition's articles in the order a reader meets them: the page plan's, then the sections', then arrival. */
async function editionArticles(editionId: string, includeUnapproved: boolean): Promise<LoadedArticle[]> {
  const rows = await db
    .select({
      id: s.articles.id,
      headline: s.articles.headline,
      standfirst: s.articles.standfirst,
      body: s.articles.body,
      language: s.articles.language,
      status: s.articles.status,
      storyId: s.stories.id,
      storyTitle: s.stories.title,
      storyType: s.stories.storyType,
      storyStatus: s.stories.status,
      storyCreated: s.stories.createdAt,
      sectionOrder: s.editionSections.sortOrder,
    })
    .from(s.articles)
    .innerJoin(s.stories, eq(s.stories.id, s.articles.storyId))
    .leftJoin(s.editionSections, eq(s.editionSections.id, s.stories.sectionId))
    .where(eq(s.articles.editionId, editionId));

  const plan = await db.query.pagePlans.findFirst({ where: and(eq(s.pagePlans.editionId, editionId), eq(s.pagePlans.isActive, true)), orderBy: [desc(s.pagePlans.createdAt)] });
  const pageOf = new Map<string, number>();
  if (plan) {
    const pages = await db.select({ pageNumber: s.pagePlanPages.pageNumber, storyId: s.pagePlanPages.storyId, storyIds: s.pagePlanPages.storyIds }).from(s.pagePlanPages).where(eq(s.pagePlanPages.planId, plan.id)).orderBy(asc(s.pagePlanPages.pageNumber));
    for (const page of pages) for (const storyId of [page.storyId, ...page.storyIds]) if (storyId && !pageOf.has(storyId)) pageOf.set(storyId, page.pageNumber);
  }

  return rows
    .filter((row) => (includeUnapproved ? row.status !== "EMPTY" : row.status === "APPROVED" || row.status === "LOCKED"))
    .filter((row) => !["REJECTED", "DROPPED"].includes(row.storyStatus))
    .sort((a, b) => (pageOf.get(a.storyId) ?? 9999) - (pageOf.get(b.storyId) ?? 9999) || (a.sectionOrder ?? 999) - (b.sectionOrder ?? 999) || a.storyCreated.getTime() - b.storyCreated.getTime())
    .map((row) => ({ id: row.id, headline: row.headline || row.storyTitle, standfirst: row.standfirst, body: row.body ?? [], language: row.language, storyType: row.storyType }));
}

function firstWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : `${words.slice(0, max).join(" ")}…`;
}

/** An article as blocks, at the depth the kind of narration wants. */
export function articleBlocks(article: LoadedArticle, mode: "full" | "summary" | "executive"): SourceBlock[] {
  const chapter = article.headline;
  const sourceId = article.id;
  const blocks: SourceBlock[] = [{ kind: "heading", text: article.headline, chapter, sourceId }];
  const paragraphs = article.body.filter((block): block is Extract<ArticleBlock, { type: "paragraph" }> => block.type === "paragraph");

  if (mode === "summary") {
    const lead = article.standfirst?.trim() || paragraphs[0]?.text || "";
    if (lead) blocks.push({ kind: "paragraph", text: firstWords(lead, 70), chapter, sourceId });
    return blocks;
  }
  if (mode === "executive") {
    if (article.standfirst?.trim()) blocks.push({ kind: "paragraph", text: article.standfirst.trim(), chapter, sourceId });
    for (const paragraph of paragraphs.slice(0, 2)) blocks.push({ kind: "paragraph", text: paragraph.text, chapter, sourceId });
    const figures = article.body.filter((block): block is Extract<ArticleBlock, { type: "box" }> => block.type === "box").slice(0, 1);
    for (const box of figures) blocks.push({ kind: "aside", text: [box.title, box.text, ...(box.items ?? [])].filter(Boolean).join(". "), chapter, sourceId });
    return blocks;
  }

  if (article.standfirst?.trim()) blocks.push({ kind: "paragraph", text: article.standfirst.trim(), chapter, sourceId });
  for (const block of article.body) {
    switch (block.type) {
      case "paragraph":
        blocks.push({ kind: "paragraph", text: block.text, chapter, sourceId });
        break;
      case "crosshead":
        blocks.push({ kind: "heading", text: block.text, chapter, sourceId });
        break;
      case "pullquote":
        // A pull quote repeats a line from the body; read once, in its place, it is the body's job.
        break;
      case "testimony":
        blocks.push({ kind: "quote", text: block.text, speaker: block.speaker ?? null, attribution: block.speaker ?? null, chapter, sourceId });
        break;
      case "list":
        blocks.push({ kind: "paragraph", text: block.items.map((item) => item.replace(/[.;]\s*$/, "")).join(". ") + ".", chapter, sourceId });
        break;
      case "box":
        blocks.push({ kind: "aside", text: [block.title, block.text, ...(block.items ?? [])].filter(Boolean).join(". "), chapter, sourceId });
        break;
      case "qa":
        blocks.push({ kind: "paragraph", text: block.question, chapter, sourceId });
        blocks.push({ kind: "qa", text: block.answer, speaker: "interviewee", chapter, sourceId });
        break;
      case "image":
      case "divider":
        break;
    }
  }
  return blocks;
}

async function organizationName(organizationId: string): Promise<string> {
  const organization = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { name: true } });
  return organization?.name ?? "";
}

async function editionContext(editionId: string, organizationId: string) {
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
  if (!edition || edition.organizationId !== organizationId) throw new NotFoundError("Edition");
  const publication = edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId) }) : null;
  return { edition, publication };
}

export async function loadSource(input: SourceInput): Promise<NarrationSource> {
  const orgName = await organizationName(input.organizationId);

  if (input.kind === "CUSTOM") {
    const text = input.customText?.trim() ?? "";
    if (text.split(/\s+/).length < 3) throw new ValidationError("Give the narration some words to say.");
    const blocks: SourceBlock[] = text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => ({ kind: "custom" as const, text: paragraph }));
    return { title: firstWords(text, 8), blocks, sample: text.slice(0, 6000), publicationId: null, publicationName: null, publicationLanguage: null, articleLanguage: null, editionLabel: null, organizationName: orgName, sceneHolds: null };
  }

  if (input.kind === "VIDEO") {
    if (!input.packId) throw new ValidationError("A film narration needs a Studio pack.");
    const pack = await db.query.creativePacks.findFirst({ where: eq(s.creativePacks.id, input.packId) });
    if (!pack || pack.organizationId !== input.organizationId) throw new NotFoundError("Pack");
    if (!pack.spec) throw new ValidationError("This pack has no scenes yet. Direct it first.");
    const motion = planMotion(pack.spec, pack.motionSystem);
    const blocks: SourceBlock[] = pack.spec.frames.map((frame, index) => {
      const words = frame.text.filter((block) => block.layer !== "background").map((block) => block.content.trim()).filter(Boolean);
      const hold = motion.scenes[index]?.hold ?? 3;
      return { kind: "scene", text: words.join(". "), chapter: null, sceneIndex: index, maxSeconds: Math.round((hold * MAX_HOLD_STRETCH - SCENE_PADDING_SECONDS * 2) * 100) / 100, sourceId: null };
    });
    const publication = pack.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, pack.publicationId) }) : null;
    const brief = pack.brief;
    const sample = [brief?.intent, brief?.caption, ...blocks.map((block) => block.text)].filter(Boolean).join("\n\n");
    return { title: pack.name, blocks, sample: sample.slice(0, 6000), publicationId: pack.publicationId, publicationName: publication?.name ?? null, publicationLanguage: publication?.language ?? null, articleLanguage: null, editionLabel: null, organizationName: orgName, sceneHolds: motion.scenes.map((scene) => scene.hold) };
  }

  if (input.kind === "ARTICLE") {
    if (!input.articleId) throw new ValidationError("Choose an article to read.");
    const article = await db.query.articles.findFirst({ where: eq(s.articles.id, input.articleId) });
    if (!article || !article.editionId) throw new NotFoundError("Article");
    const { edition, publication } = await editionContext(article.editionId, input.organizationId);
    const story = await db.query.stories.findFirst({ where: eq(s.stories.id, article.storyId), columns: { title: true, storyType: true } });
    const loaded: LoadedArticle = { id: article.id, headline: article.headline || story?.title || "", standfirst: article.standfirst, body: article.body ?? [], language: article.language, storyType: story?.storyType ?? "OTHER" };
    const blocks = articleBlocks(loaded, "full");
    return { title: loaded.headline, blocks, sample: blocks.map((block) => block.text).join("\n\n").slice(0, 6000), publicationId: edition.publicationId, publicationName: publication?.name ?? null, publicationLanguage: publication?.language ?? null, articleLanguage: article.language, editionLabel: edition.label, organizationName: orgName, sceneHolds: null };
  }

  if (!input.editionId) throw new ValidationError("Choose an edition to read.");
  const { edition, publication } = await editionContext(input.editionId, input.organizationId);
  const articles = await editionArticles(edition.id, input.includeUnapproved ?? false);
  if (!articles.length) throw new ValidationError(input.includeUnapproved ? "This edition has no written articles yet." : "This edition has no approved articles yet. Approve them, or make a preview.");
  const mode = input.kind === "SUMMARY" ? "summary" : input.kind === "EXECUTIVE" ? "executive" : "full";
  const blocks: SourceBlock[] = [];
  if (mode === "full" && edition.editorial?.trim()) blocks.push({ kind: "paragraph", text: edition.editorial.trim(), chapter: publication?.name ?? edition.title, sourceId: null });
  for (const article of articles) blocks.push(...articleBlocks(article, mode));
  const languages = [...new Set(articles.map((article) => article.language))];
  const issue = issueLabelFor(edition.issueNumber, edition.isSpecialIssue);
  const titles: Record<NarrationKind, string> = { EDITION: `${publication?.name ?? edition.title} · ${edition.label}`, SUMMARY: `${edition.label} · digest`, EXECUTIVE: `${edition.label} · briefing`, ARTICLE: "", VIDEO: "", CUSTOM: "" };
  return {
    title: titles[input.kind] || `${edition.label} · ${issue}`,
    blocks,
    sample: blocks.map((block) => block.text).join("\n\n").slice(0, 6000),
    publicationId: edition.publicationId,
    publicationName: publication?.name ?? null,
    publicationLanguage: publication?.language ?? null,
    articleLanguage: languages.length === 1 ? languages[0] : null,
    editionLabel: edition.label,
    organizationName: orgName,
    sceneHolds: null,
  };
}

/* ── Framing ──────────────────────────────────────────────────────────────────────────────── */

type Framing = { intro: (title: string, edition: string | null, org: string) => string; digest: (title: string, edition: string | null) => string; briefing: (title: string, edition: string | null) => string; outro: (org: string) => string };

/** The lines around the edition, in the language it is read in. Short, and never in another language. */
const FRAMING: Record<SpeechLanguage, Framing> = {
  en: {
    intro: (title, edition, org) => `${title}${edition ? `, ${edition}` : ""}. From ${org}.`,
    digest: (title, edition) => `The digest of ${title}${edition ? `, ${edition}` : ""}. The essentials, in a few minutes.`,
    briefing: (title, edition) => `${title}${edition ? `, ${edition}` : ""}. An executive briefing.`,
    outro: (org) => `That was ${org}. Thank you for listening.`,
  },
  fr: {
    intro: (title, edition, org) => `${title}${edition ? `, ${edition}` : ""}. Par ${org}.`,
    digest: (title, edition) => `L'essentiel de ${title}${edition ? `, ${edition}` : ""}, en quelques minutes.`,
    briefing: (title, edition) => `${title}${edition ? `, ${edition}` : ""}. Le briefing.`,
    outro: (org) => `C'était ${org}. Merci de votre écoute.`,
  },
  es: {
    intro: (title, edition, org) => `${title}${edition ? `, ${edition}` : ""}. De ${org}.`,
    digest: (title, edition) => `Lo esencial de ${title}${edition ? `, ${edition}` : ""}, en pocos minutos.`,
    briefing: (title, edition) => `${title}${edition ? `, ${edition}` : ""}. El informe ejecutivo.`,
    outro: (org) => `Esto fue ${org}. Gracias por escuchar.`,
  },
  de: {
    intro: (title, edition, org) => `${title}${edition ? `, ${edition}` : ""}. Von ${org}.`,
    digest: (title, edition) => `Das Wichtigste aus ${title}${edition ? `, ${edition}` : ""}, in wenigen Minuten.`,
    briefing: (title, edition) => `${title}${edition ? `, ${edition}` : ""}. Das Briefing.`,
    outro: (org) => `Das war ${org}. Danke fürs Zuhören.`,
  },
  it: {
    intro: (title, edition, org) => `${title}${edition ? `, ${edition}` : ""}. Da ${org}.`,
    digest: (title, edition) => `L'essenziale di ${title}${edition ? `, ${edition}` : ""}, in pochi minuti.`,
    briefing: (title, edition) => `${title}${edition ? `, ${edition}` : ""}. Il briefing.`,
    outro: (org) => `Questo era ${org}. Grazie per l'ascolto.`,
  },
  pt: {
    intro: (title, edition, org) => `${title}${edition ? `, ${edition}` : ""}. De ${org}.`,
    digest: (title, edition) => `O essencial de ${title}${edition ? `, ${edition}` : ""}, em poucos minutos.`,
    briefing: (title, edition) => `${title}${edition ? `, ${edition}` : ""}. O briefing.`,
    outro: (org) => `Foi ${org}. Obrigado por ouvir.`,
  },
  nl: {
    intro: (title, edition, org) => `${title}${edition ? `, ${edition}` : ""}. Van ${org}.`,
    digest: (title, edition) => `Het belangrijkste uit ${title}${edition ? `, ${edition}` : ""}, in een paar minuten.`,
    briefing: (title, edition) => `${title}${edition ? `, ${edition}` : ""}. De briefing.`,
    outro: (org) => `Dit was ${org}. Bedankt voor het luisteren.`,
  },
};

/** The opening and closing lines, once the language is known. Films and custom texts get none. */
export function framedBlocks(source: NarrationSource, kind: NarrationKind, language: SpeechLanguage): SourceBlock[] {
  if (kind === "VIDEO" || kind === "CUSTOM") return source.blocks;
  const words = FRAMING[language];
  const title = source.publicationName ?? source.title;
  const org = source.organizationName || title;
  const intro = kind === "SUMMARY" ? words.digest(title, source.editionLabel) : kind === "EXECUTIVE" ? words.briefing(title, source.editionLabel) : kind === "ARTICLE" ? `${source.title}. ${title}${source.editionLabel ? `, ${source.editionLabel}` : ""}.` : words.intro(title, source.editionLabel, org);
  const blocks: SourceBlock[] = [{ kind: "custom", text: intro, chapter: null }, ...source.blocks];
  if (kind !== "ARTICLE") blocks.push({ kind: "custom", text: words.outro(org), chapter: null });
  return blocks;
}

/** Everything in a set of blocks, joined, for the language check and the size guard. */
export function blocksText(blocks: SourceBlock[]): string {
  return blocks.map((block) => block.text).join("\n\n");
}

export async function articlesForPicker(editionId: string): Promise<{ id: string; headline: string; status: string }[]> {
  const rows = await db
    .select({ id: s.articles.id, headline: s.articles.headline, status: s.articles.status, storyTitle: s.stories.title })
    .from(s.articles)
    .innerJoin(s.stories, eq(s.stories.id, s.articles.storyId))
    .where(and(eq(s.articles.editionId, editionId), inArray(s.articles.status, ["AI_DRAFT", "IN_EDITING", "READY_FOR_REVIEW", "APPROVED", "LOCKED"])))
    .orderBy(asc(s.stories.createdAt));
  return rows.map((row) => ({ id: row.id, headline: row.headline || row.storyTitle, status: row.status }));
}
