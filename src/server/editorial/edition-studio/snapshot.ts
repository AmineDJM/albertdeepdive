import { and, eq, notExists, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getFlatplan } from "@/server/publication/flatplan";
import { NotFoundError } from "@/lib/action-result";

/**
 * What the studio knows about an issue before it is asked anything.
 *
 * This is the difference between an assistant and a command line. Told "there is too much white",
 * something holding this can answer "page 6 is a fifth full and the KÆRN story brought four
 * photographs nobody placed" — because the pages carry their measured fill, the stories carry their
 * word counts, and the photographs that arrived and never found a page are listed. Everything here
 * is measured or counted; none of it is the model's opinion.
 */
export type StudioPage = {
  id: string;
  number: number;
  template: string;
  templateName: string;
  /** cover | front | article | bdd | news | visual | back — the families the templates declare. */
  templateFamily: string;
  /**
   * A cover, a contents page or a back page is furniture: it is where it is, it is as full as it is
   * meant to be, and an assistant that reads its 0 % fill as a problem will try to fix the wrong
   * thing. Saying so in the snapshot is cheaper than hoping the model infers it from the name.
   */
  isFurniture: boolean;
  sectionName: string | null;
  /** Share of the page the composition actually fills, measured where the engine has run. */
  fill: number;
  fillSource: "measured" | "estimated";
  words: number;
  capacityWords: number;
  imageSlots: number;
  imagesUsed: number;
  isLocked: boolean;
  notes: string | null;
  stories: { id: string; title: string; articleId: string | null; words: number }[];
};

export type StudioArticle = {
  id: string;
  storyId: string;
  headline: string;
  words: number;
  status: string;
  sectionName: string | null;
  page: number | null;
};

export type StudioSnapshot = {
  edition: {
    id: string;
    label: string;
    issueLabel: string;
    status: string;
    extentMode: "auto" | "fixed";
    targetPages: number;
    pages: number;
    words: number;
  };
  pages: StudioPage[];
  articles: StudioArticle[];
  /** Photographs that belong to this issue and sit on no story: the room the studio can spend. */
  spareMedia: { id: string; fileName: string; caption: string | null }[];
  /** What the layout pass and the quality gates are already complaining about. */
  warnings: string[];
  /** Null when Chromium could not run, so the interface can say the fills are estimates. */
  measurementError: string | null;
};

export async function buildSnapshot(editionId: string): Promise<StudioSnapshot> {
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const flatplan = await getFlatplan(editionId, { measure: false });

  const articleRows = await db
    .select({ id: s.articles.id, storyId: s.articles.storyId, headline: s.articles.headline, words: s.articles.wordCount, status: s.articles.status })
    .from(s.articles)
    .where(eq(s.articles.editionId, editionId));
  const articleByStory = new Map(articleRows.map((a) => [a.storyId, a]));
  const storyRef = new Map(flatplan.stories.map((st) => [st.id, st]));

  const spare = await db
    .select({ id: s.mediaAssets.id, fileName: s.mediaAssets.fileName, caption: s.mediaAssets.caption })
    .from(s.mediaAssets)
    .where(
      and(
        eq(s.mediaAssets.editionId, editionId),
        eq(s.mediaAssets.isArchived, false),
        notExists(db.select({ one: sql`1` }).from(s.storyMedia).where(eq(s.storyMedia.mediaAssetId, s.mediaAssets.id))),
      ),
    )
    .limit(60);

  const pages: StudioPage[] = flatplan.pages.map((p) => ({
    id: p.id,
    number: p.number,
    template: p.template,
    templateName: p.templateName,
    templateFamily: p.templateFamily,
    isFurniture: ["cover", "front", "back"].includes(p.templateFamily),
    sectionName: p.section?.name ?? null,
    fill: Math.round(p.fill * 100) / 100,
    fillSource: p.fillSource,
    words: p.words,
    capacityWords: p.capacityWords,
    imageSlots: p.imageSlots,
    imagesUsed: p.images.length,
    isLocked: p.isLocked,
    notes: p.notes,
    stories: p.items.map((item) => {
      const ref = storyRef.get(item.storyId);
      return { id: item.storyId, title: item.headline || item.storyTitle, articleId: item.articleId ?? articleByStory.get(item.storyId)?.id ?? null, words: item.wordCount || (ref?.wordCount ?? 0) };
    }),
  }));

  return {
    edition: {
      id: edition.id,
      label: edition.label,
      issueLabel: flatplan.edition.issueLabel,
      status: edition.status,
      extentMode: edition.pageCountMode === "fixed" ? "fixed" : "auto",
      targetPages: edition.targetPageCount,
      pages: flatplan.stats.pages,
      words: flatplan.stats.words,
    },
    pages,
    articles: articleRows.map((a) => ({
      id: a.id,
      storyId: a.storyId,
      headline: a.headline,
      words: a.words,
      status: a.status,
      sectionName: storyRef.get(a.storyId)?.sectionName ?? null,
      page: storyRef.get(a.storyId)?.page ?? null,
    })),
    spareMedia: spare,
    warnings: flatplan.warnings.map((w) => w.message).slice(0, 20),
    measurementError: flatplan.measurementError,
  };
}

/**
 * The snapshot as the model reads it.
 *
 * Tables rather than nested JSON, because that is what a model reads accurately, and ids spelled in
 * full because an operation naming a page has to name the real one. Long issues are summarised
 * rather than truncated in the middle: a list that stops at page 14 without saying so would have the
 * assistant confidently declare there is no page 15.
 */
export function snapshotForPrompt(snap: StudioSnapshot, options: { maxPages?: number; maxArticles?: number } = {}): string {
  const maxPages = options.maxPages ?? 60;
  const maxArticles = options.maxArticles ?? 60;
  const lines: string[] = [];
  const e = snap.edition;
  lines.push(`ISSUE: ${e.issueLabel} — ${e.label} (status ${e.status})`);
  lines.push(`EXTENT: ${e.extentMode === "fixed" ? `exactly ${e.targetPages} pages (promised to a printer)` : `a ceiling of ${e.targetPages} pages`} · currently ${e.pages} pages · ${e.words} words`);
  if (snap.measurementError) lines.push(`NOTE: the fills below are estimates — the measuring pass could not run (${snap.measurementError}).`);

  lines.push("", "PAGES (id · number · template · section · fill · words/capacity · pictures · stories)");
  lines.push("FURNITURE marks the cover, the contents and the back page: they are where they are and as full as they should be.");
  const shownPages = snap.pages.slice(0, maxPages);
  for (const p of shownPages) {
    const stories = p.stories.length ? p.stories.map((st) => `${st.title} [story ${st.id}${st.articleId ? `, article ${st.articleId}` : ""}]`).join("; ") : "—";
    const flags = [p.isFurniture ? "FURNITURE" : null, p.isLocked ? "LOCKED" : null].filter(Boolean).join(" ");
    lines.push(`${p.id} · p${p.number} · ${p.template} · ${p.sectionName ?? "—"} · ${Math.round(p.fill * 100)}% · ${p.words}/${p.capacityWords} · ${p.imagesUsed}/${p.imageSlots}${flags ? ` · ${flags}` : ""} · ${stories}`);
  }
  if (snap.pages.length > shownPages.length) lines.push(`… and ${snap.pages.length - shownPages.length} more pages, not listed here.`);

  lines.push("", "ARTICLES (id · headline · words · section · page · status)");
  const shownArticles = snap.articles.slice(0, maxArticles);
  for (const a of shownArticles) lines.push(`${a.id} · ${a.headline} · ${a.words}w · ${a.sectionName ?? "—"} · ${a.page ? `p${a.page}` : "unplaced"} · ${a.status}`);
  if (snap.articles.length > shownArticles.length) lines.push(`… and ${snap.articles.length - shownArticles.length} more articles, not listed here.`);

  if (snap.spareMedia.length) {
    lines.push("", "PHOTOGRAPHS ON NO STORY (id · file · caption)");
    for (const m of snap.spareMedia.slice(0, 30)) lines.push(`${m.id} · ${m.fileName} · ${m.caption ?? "—"}`);
  }
  if (snap.warnings.length) {
    lines.push("", "ALREADY REPORTED");
    for (const w of snap.warnings) lines.push(`- ${w}`);
  }
  return lines.join("\n");
}
