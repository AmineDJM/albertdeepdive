import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import { articleRevisions, articleSources, articles, businessDeepDives, campuses, facts, quotes, stories, storyCampuses, submissions, type ArticleBlock, type ArticleProvenance, type WarningItem } from "@/server/db/schema";
import { audit, recordDecision } from "@/server/audit";
import { createLogger } from "@/server/logger";
import type { JobContext } from "@/server/jobs/registry";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { articleBlockSchema, countWords, newBlockId, plainText } from "@/lib/publication/document";
import { editSimilarity } from "@/lib/editorial/similarity";
import {
  buildFactSheet,
  checkConsistency,
  copyEditArticle,
  draftArticleBlocks,
  fromAiBlocks,
  generateHeadlines,
  generateStandfirst,
  harmonizeTone,
  selectPullQuote,
  translateArticle,
  type AiServiceContext,
  type DraftFact,
  type DraftQuote,
} from "@/server/ai/services";
import { notifyRole, notifyUsers } from "./notifications";
import { addComment } from "./comments";
import { targetWordsFor } from "./stories";

const log = createLogger("editorial:articles");

export type ArticleRow = typeof articles.$inferSelect;
export type ArticleStatus = ArticleRow["status"];

type StoryContext = {
  story: typeof stories.$inferSelect & { section: { slug: string; kicker: string | null } | null; cluster: { id: string; members: { submissionId: string; isPrimary: boolean }[] } | null };
  submissions: (typeof submissions.$inferSelect & { contributor: { id: string; firstName: string; lastName: string } | null })[];
  primary: (typeof submissions.$inferSelect & { contributor: { id: string; firstName: string; lastName: string } | null }) | null;
  facts: (typeof facts.$inferSelect)[];
  quotes: (typeof quotes.$inferSelect)[];
  bdd: typeof businessDeepDives.$inferSelect | null;
  campusNames: string[];
  campusSlugs: string[];
};

async function loadStoryContext(storyId: string): Promise<StoryContext> {
  const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId), with: { section: { columns: { slug: true, kicker: true } }, cluster: { columns: { id: true }, with: { members: { columns: { submissionId: true, isPrimary: true } } } } } });
  if (!story) throw new NotFoundError("Story");
  const memberIds = story.cluster?.members.map((m) => m.submissionId) ?? [];
  const subs = memberIds.length ? await db.query.submissions.findMany({ where: inArray(submissions.id, memberIds), with: { contributor: { columns: { id: true, firstName: true, lastName: true } } }, orderBy: [asc(submissions.createdAt)] }) : [];
  const primaryId = story.cluster?.members.find((m) => m.isPrimary)?.submissionId;
  subs.sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId) || a.createdAt.getTime() - b.createdAt.getTime());
  const factRows = await db.query.facts.findMany({ where: eq(facts.storyId, storyId), orderBy: [asc(facts.createdAt)] });
  const quoteRows = await db.query.quotes.findMany({ where: eq(quotes.storyId, storyId), orderBy: [asc(quotes.createdAt)] });
  const bdd = (await db.query.businessDeepDives.findFirst({ where: eq(businessDeepDives.storyId, storyId) })) ?? null;
  const campusLinks = await db.select({ name: campuses.name, slug: campuses.slug }).from(storyCampuses).innerJoin(campuses, eq(campuses.id, storyCampuses.campusId)).where(eq(storyCampuses.storyId, storyId));
  return { story, submissions: subs, primary: subs[0] ?? null, facts: factRows, quotes: quoteRows, bdd, campusNames: campusLinks.map((c) => c.name), campusSlugs: campusLinks.map((c) => c.slug) };
}

function contributorName(sub: { contributor: { firstName: string; lastName: string } | null; contactName: string | null } | null): string | null {
  if (!sub) return null;
  return sub.contributor ? `${sub.contributor.firstName} ${sub.contributor.lastName}` : sub.contactName;
}

function submissionText(sub: typeof submissions.$inferSelect): string {
  return sub.normalizedText ?? [sub.description, sub.peopleInvolved ? `People involved: ${sub.peopleInvolved}` : "", sub.organisationsInvolved ? `Organisations: ${sub.organisationsInvolved}` : ""].filter(Boolean).join("\n");
}

/** Stories created without a cluster fact sheet get one built on the fly from their submissions. */
async function ensureFacts(ctx: StoryContext, aiCtx: AiServiceContext): Promise<StoryContext> {
  if (ctx.facts.length || !ctx.submissions.length) return ctx;
  const sheet = await buildFactSheet({ submissions: ctx.submissions.map((s) => ({ id: s.id, title: s.title, text: submissionText(s), storyType: s.storyType, contributor: contributorName(s), quotes: s.quotes })) }, aiCtx);
  if (sheet.output.facts.length) {
    await db.insert(facts).values(
      sheet.output.facts.map((f, i) => ({
        editionId: ctx.story.editionId,
        storyId: ctx.story.id,
        clusterId: ctx.story.clusterId,
        statement: f.statement,
        category: f.category,
        sourceSubmissionId: f.sourceSubmissionIds[0] ?? null,
        sourceExcerpt: f.excerpt ?? null,
        confidence: f.confidence,
        status: f.confidence === "CONFLICTING" ? ("DISPUTED" as const) : ("ACTIVE" as const),
        conflictGroup: f.confidence === "CONFLICTING" ? `${ctx.story.id.slice(0, 8)}-conflict-${i + 1}` : null,
        createdByAi: true,
      })),
    );
  }
  if (sheet.output.quotes.length && !ctx.quotes.length) {
    await db.insert(quotes).values(sheet.output.quotes.map((q) => ({ editionId: ctx.story.editionId, storyId: ctx.story.id, clusterId: ctx.story.clusterId, text: q.text, speakerName: q.speakerName, speakerRole: q.speakerRole, sourceSubmissionId: q.sourceSubmissionId, isPullQuoteCandidate: !!q.speakerName && q.text.length <= 140, aiScore: q.speakerName ? 0.8 : 0.5, createdByAi: true })));
  }
  return loadStoryContext(ctx.story.id);
}

function toDraftFacts(rows: (typeof facts.$inferSelect)[]): DraftFact[] {
  return rows.filter((f) => f.status !== "REJECTED").map((f) => ({ id: f.id, statement: f.statement, category: f.category, confidence: f.confidence, status: f.status, sourceSubmissionId: f.sourceSubmissionId }));
}

function toDraftQuotes(rows: (typeof quotes.$inferSelect)[]): DraftQuote[] {
  return rows.map((q) => ({ id: q.id, text: q.text, speaker: q.speakerName, role: q.speakerRole, sourceSubmissionId: q.sourceSubmissionId }));
}

export type DraftArticleResult = { article: ArticleRow; revision: typeof articleRevisions.$inferSelect; cautions: string[]; aiJobIds: string[]; costCents: number };

/**
 * Drafts the article of a story from its facts, quotes and submissions: blocks (with sources and
 * provenance), headline + alternatives, standfirst and pull quote. Writes the article, a revision
 * (created by AI) and the article sources; moves the story to DRAFTING.
 */
export async function draftArticle(storyId: string, opts: { userId?: string | null; instruction?: string | null; jobCtx?: Pick<JobContext, "progress" | "log"> | null; jobId?: string | null } = {}): Promise<DraftArticleResult> {
  let ctx = await loadStoryContext(storyId);
  if (!ctx.submissions.length && !ctx.facts.length) throw new ValidationError("The story has no submissions or facts to write from");
  const existing = await db.query.articles.findFirst({ where: eq(articles.storyId, storyId) });
  if (existing?.status === "LOCKED") throw new ValidationError("The article is locked");
  const aiCtx: AiServiceContext = { editionId: ctx.story.editionId, entityType: "STORY", entityId: storyId, jobId: opts.jobId ?? null };
  ctx = await ensureFacts(ctx, aiCtx);
  const aiJobIds: string[] = [];
  let costCents = 0;
  const track = <T extends { aiJobId: string; usage: { costCents: number } }>(r: T) => {
    aiJobIds.push(r.aiJobId);
    costCents += r.usage.costCents;
    return r;
  };
  await opts.jobCtx?.progress?.(1, 5, "Drafting the article");

  const draftFacts = toDraftFacts(ctx.facts);
  const draftQuotes = toDraftQuotes(ctx.quotes);
  const draft = track(
    await draftArticleBlocks(
      {
        storyType: ctx.story.storyType,
        targetLength: ctx.story.targetLength,
        targetWords: targetWordsFor(ctx.story.targetLength),
        title: ctx.story.title,
        campuses: ctx.campusNames,
        facts: draftFacts,
        quotes: draftQuotes,
        submissions: ctx.submissions.map((s) => ({ id: s.id, title: s.title, text: submissionText(s), storyType: s.storyType, contributor: contributorName(s) })),
        editorNotes: [ctx.story.editorialNotes, opts.instruction].filter(Boolean).join("\n") || null,
        bdd: ctx.bdd ? { companyName: ctx.bdd.companyName, cohortLabel: ctx.bdd.cohortLabel, dateText: ctx.bdd.dateText, technologies: ctx.bdd.technologies, winningTeam: ctx.bdd.winningTeam, jury: ctx.bdd.jury } : null,
      },
      { ...aiCtx, entityType: "ARTICLE", entityId: existing?.id ?? null },
    ),
  );

  const factById = new Map(ctx.facts.map((f) => [f.id, f]));
  const quoteById = new Map(ctx.quotes.map((q) => [q.id, q]));
  const primaryId = ctx.primary?.id ?? null;
  const sourcesFor = (factIds: string[]): { submissionIds: string[]; factIds: string[] } => {
    const valid = factIds.filter((id) => factById.has(id));
    const submissionIds = [...new Set(valid.map((id) => factById.get(id)!.sourceSubmissionId).filter((id): id is string => !!id))];
    return { submissionIds: submissionIds.length ? submissionIds : primaryId ? [primaryId] : [], factIds: valid };
  };
  const body: ArticleBlock[] = [];
  const provenance: ArticleProvenance = {};
  for (const b of draft.output.blocks) {
    const id = newBlockId();
    switch (b.type) {
      case "paragraph": {
        const src = sourcesFor(b.factIds);
        body.push({ id, type: "paragraph", text: b.text, sources: src.submissionIds });
        provenance[id] = { ...src, ...(src.factIds.length ? {} : { note: "No fact cited by the drafter" }) };
        break;
      }
      case "crosshead":
        body.push({ id, type: "crosshead", text: b.text });
        break;
      case "qa": {
        const src = sourcesFor(b.factIds);
        body.push({ id, type: "qa", question: b.question, answer: b.answer, sources: src.submissionIds });
        provenance[id] = src;
        break;
      }
      case "list": {
        const src = sourcesFor(b.factIds);
        body.push({ id, type: "list", items: b.items, sources: src.submissionIds });
        provenance[id] = src;
        break;
      }
      case "box": {
        const src = sourcesFor(b.factIds);
        body.push({ id, type: "box", title: b.title, items: b.items, sources: src.submissionIds });
        provenance[id] = src;
        break;
      }
      case "pullquote": {
        const q = quoteById.get(b.quoteId);
        if (!q) break;
        body.push({ id, type: "pullquote", text: q.text, attribution: q.speakerName ?? undefined, sources: q.sourceSubmissionId ? [q.sourceSubmissionId] : [] });
        provenance[id] = { submissionIds: q.sourceSubmissionId ? [q.sourceSubmissionId] : [], note: `Quote ${q.id}` };
        break;
      }
      case "testimony": {
        const q = b.quoteId ? quoteById.get(b.quoteId) : null;
        const text = q?.text ?? b.text;
        if (!text) break;
        const speaker = q?.speakerName ?? b.speaker ?? undefined;
        const src = q ? { submissionIds: q.sourceSubmissionId ? [q.sourceSubmissionId] : [], factIds: [] as string[] } : sourcesFor(b.factIds);
        const speakerSub = !q && speaker ? ctx.submissions.find((s) => contributorName(s) === speaker) : null;
        const submissionIds = src.submissionIds.length ? src.submissionIds : speakerSub ? [speakerSub.id] : primaryId ? [primaryId] : [];
        body.push({ id, type: "testimony", text, speaker, sources: submissionIds });
        provenance[id] = { submissionIds, factIds: src.factIds, ...(q ? { note: `Quote ${q.id}` } : {}) };
        break;
      }
    }
  }
  if (!body.length) throw new ValidationError("The drafter returned no usable blocks");

  await opts.jobCtx?.progress?.(2, 5, "Headlines");
  const headlines = track(await generateHeadlines({ storyType: ctx.story.storyType, title: ctx.story.title, facts: draftFacts.filter((f) => f.status !== "DISPUTED").map((f) => ({ id: f.id, statement: f.statement, category: f.category })), count: 5, company: ctx.bdd?.companyName ?? null, cohort: ctx.bdd?.cohortLabel ?? null, currentHeadline: existing?.headline || null }, aiCtx));
  const alternatives = headlines.output.headlines.map((h) => h.text.trim()).filter(Boolean);
  const headline = alternatives[0] ?? ctx.story.title;

  await opts.jobCtx?.progress?.(3, 5, "Standfirst");
  const bodyForStandfirst = plainText(body.filter((b) => b.type === "paragraph" || b.type === "qa" || b.type === "testimony"));
  const standfirst = track(await generateStandfirst({ headline, body: bodyForStandfirst }, aiCtx)).output.standfirst.trim() || null;

  await opts.jobCtx?.progress?.(4, 5, "Pull quote");
  if (ctx.quotes.length) {
    const pull = track(await selectPullQuote({ quotes: ctx.quotes.map((q) => ({ id: q.id, text: q.text, speaker: q.speakerName, role: q.speakerRole })) }, aiCtx));
    const chosen = pull.output.quoteId ? quoteById.get(pull.output.quoteId) : null;
    if (chosen && !body.some((b) => b.type === "pullquote")) {
      const text = pull.output.text?.trim() || chosen.text;
      const firstParagraph = body.findIndex((b) => b.type === "paragraph" || b.type === "qa");
      const id = newBlockId();
      body.splice(firstParagraph >= 0 ? firstParagraph + 1 : body.length, 0, { id, type: "pullquote", text, attribution: chosen.speakerName ?? undefined, sources: chosen.sourceSubmissionId ? [chosen.sourceSubmissionId] : [] });
      provenance[id] = { submissionIds: chosen.sourceSubmissionId ? [chosen.sourceSubmissionId] : [], note: `Quote ${chosen.id} (${pull.output.reason})` };
      await db.update(quotes).set({ isPullQuoteCandidate: true }).where(eq(quotes.id, chosen.id));
    }
  }

  const kicker = ctx.bdd ? [ctx.bdd.companyName, ctx.bdd.cohortLabel].filter(Boolean).join(" – ") : (ctx.story.section?.kicker ?? existing?.kicker ?? null);
  const byline = contributorName(ctx.primary) ?? existing?.byline ?? null;
  const warnings: WarningItem[] = draft.output.cautions.map((c) => ({ code: "AI_CAUTION", message: c, severity: "info" as const }));
  const wordCount = countWords(body);
  const version = (existing?.currentRevision ?? 0) + 1;
  const tags = [...new Set([ctx.story.section?.slug, ...ctx.campusSlugs, ...(existing?.tags ?? [])].filter((t): t is string => !!t))];
  const values = { kicker, headline, standfirst, byline, body, wordCount, status: "AI_DRAFT" as const, currentRevision: version, provenance, warnings, headlineAlternatives: alternatives, aiDraftedAt: new Date(), tags, authorContributorId: ctx.primary?.contributor?.id ?? existing?.authorContributorId ?? null, manualEditRatio: 0 };
  const article = existing
    ? (await db.update(articles).set(values).where(eq(articles.id, existing.id)).returning())[0]
    : (await db.insert(articles).values({ storyId, editionId: ctx.story.editionId, ...values }).returning())[0];
  const [revision] = await db
    .insert(articleRevisions)
    .values({ articleId: article.id, version, kicker, headline, standfirst, byline, body, wordCount, createdById: opts.userId ?? null, createdByAi: true, aiJobId: draft.aiJobId, changeSummary: opts.instruction ? `AI draft (${opts.instruction})` : "AI draft from the fact sheet" })
    .returning();
  await db.delete(articleSources).where(eq(articleSources.articleId, article.id));
  if (ctx.submissions.length) {
    await db.insert(articleSources).values(ctx.submissions.map((s) => ({ articleId: article.id, submissionId: s.id, role: s.status === "DUPLICATE" || s.storyType === "PHOTO_STORY" ? (s.storyType === "PHOTO_STORY" ? "PHOTO" : "SUPPORTING") : "PRIMARY" }))).onConflictDoNothing();
  }
  if (ctx.story.status === "CANDIDATE" || ctx.story.status === "SELECTED") await db.update(stories).set({ status: "DRAFTING" }).where(eq(stories.id, storyId));
  await opts.jobCtx?.progress?.(5, 5, "Done");
  await audit({ action: "article.draft", userId: opts.userId ?? null, actorType: opts.userId ? "USER" : "AI", entityType: "ARTICLE", entityId: article.id, editionId: ctx.story.editionId, metadata: { storyId, version, blocks: body.length, wordCount, aiJobIds, costCents } });
  log.info("article drafted", { articleId: article.id, storyId, version, wordCount, costCents });
  return { article, revision, cautions: draft.output.cautions, aiJobIds, costCents };
}

export const articlePatchSchema = z.object({
  kicker: z.string().nullable().optional(),
  headline: z.string().max(200).optional(),
  standfirst: z.string().nullable().optional(),
  byline: z.string().nullable().optional(),
  body: z.array(articleBlockSchema).optional(),
  tags: z.array(z.string()).optional(),
  changeSummary: z.string().nullable().optional(),
});
export type ArticlePatch = z.infer<typeof articlePatchSchema>;

async function loadArticle(articleId: string): Promise<ArticleRow> {
  const article = await db.query.articles.findFirst({ where: eq(articles.id, articleId) });
  if (!article) throw new NotFoundError("Article");
  return article;
}

function revisionText(r: { headline: string; standfirst: string | null; body: ArticleBlock[] }): string {
  return [r.headline, r.standfirst ?? "", plainText(r.body)].join("\n");
}

/** Saves an editor's changes as a new revision and updates the manual edit ratio against the last AI draft. */
export async function saveArticle(articleId: string, patch: ArticlePatch, userId: string) {
  const parsed = articlePatchSchema.safeParse(patch);
  if (!parsed.success) throw new ValidationError("Invalid article", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])));
  const article = await loadArticle(articleId);
  if (article.status === "LOCKED") throw new ValidationError("The article is locked");
  const data = parsed.data;
  const body = (data.body ?? article.body) as ArticleBlock[];
  const headline = data.headline ?? article.headline;
  const standfirst = data.standfirst === undefined ? article.standfirst : data.standfirst;
  const kicker = data.kicker === undefined ? article.kicker : data.kicker;
  const byline = data.byline === undefined ? article.byline : data.byline;
  const wordCount = countWords(body);
  const lastAi = await db.query.articleRevisions.findFirst({ where: and(eq(articleRevisions.articleId, articleId), eq(articleRevisions.createdByAi, true)), orderBy: [desc(articleRevisions.version)] });
  const manualEditRatio = lastAi ? Math.round((1 - editSimilarity(revisionText(lastAi), revisionText({ headline, standfirst, body }))) * 1000) / 1000 : 1;
  const provenance: ArticleProvenance = {};
  for (const b of body) {
    if (article.provenance[b.id]) provenance[b.id] = article.provenance[b.id];
    else if ("sources" in b && b.sources?.length) provenance[b.id] = { submissionIds: b.sources, note: "Added by an editor" };
  }
  const version = article.currentRevision + 1;
  const status: ArticleStatus = "IN_EDITING";
  const [updated] = await db
    .update(articles)
    .set({ kicker, headline, standfirst, byline, body, tags: data.tags ?? article.tags, wordCount, status, currentRevision: version, provenance, manualEditRatio, lastEditedById: userId, lastEditedAt: new Date(), approvedById: null, approvedAt: null })
    .where(eq(articles.id, articleId))
    .returning();
  const [revision] = await db
    .insert(articleRevisions)
    .values({ articleId, version, kicker, headline, standfirst, byline, body, wordCount, createdById: userId, createdByAi: false, changeSummary: data.changeSummary ?? "Editorial changes" })
    .returning();
  if (article.status === "APPROVED") await db.update(stories).set({ status: "DRAFTING" }).where(and(eq(stories.id, article.storyId), eq(stories.status, "APPROVED")));
  await audit({ action: "article.save", userId, entityType: "ARTICLE", entityId: articleId, editionId: article.editionId, metadata: { version, wordCount, manualEditRatio, fields: Object.keys(data) } });
  return { article: updated, revision };
}

export async function revisions(articleId: string) {
  await loadArticle(articleId);
  return db.query.articleRevisions.findMany({ where: eq(articleRevisions.articleId, articleId), orderBy: [desc(articleRevisions.version)], with: { createdBy: { columns: { id: true, name: true } } } });
}

export async function restoreRevision(articleId: string, version: number, userId: string) {
  const revision = await db.query.articleRevisions.findFirst({ where: and(eq(articleRevisions.articleId, articleId), eq(articleRevisions.version, version)) });
  if (!revision) throw new NotFoundError("Revision");
  const result = await saveArticle(articleId, { kicker: revision.kicker, headline: revision.headline, standfirst: revision.standfirst, byline: revision.byline, body: revision.body, changeSummary: `Restored version ${version}` }, userId);
  await recordDecision({ editionId: result.article.editionId, entityType: "ARTICLE", entityId: articleId, decision: "ARTICLE_RESTORE_REVISION", previousValue: { version: result.article.currentRevision - 1 }, newValue: { restored: version, version: result.article.currentRevision }, userId });
  return result;
}

export const ARTICLE_ACTIONS = ["shorten", "rewrite_headline", "generate_headlines", "improve_structure", "improve_english", "translate", "suggest_pull_quote", "check_consistency", "check_house_style"] as const;
export type ArticleAction = (typeof ARTICLE_ACTIONS)[number];

export type ArticleProposal = {
  action: ArticleAction;
  kind: "headline" | "headlines" | "blocks" | "pullQuote" | "issues";
  aiJobId: string;
  headline?: string;
  headlines?: { text: string; angle: string }[];
  blocks?: ArticleBlock[];
  changes?: string[];
  notes?: string[];
  pullQuote?: { quoteId: string; text: string; attribution: string | null } | null;
  reason?: string;
  issues?: WarningItem[];
  verdict?: string;
  costCents: number;
};

/**
 * Runs one AI assistant action on an article and returns a proposal. Nothing is written to the
 * article body; only check_consistency and check_house_style store their findings in warnings.
 */
export async function runArticleAction(articleId: string, action: ArticleAction, userId: string | null, options: { instruction?: string | null; targetWords?: number | null; targetLanguage?: "en" | "fr"; count?: number } = {}): Promise<ArticleProposal> {
  if (!ARTICLE_ACTIONS.includes(action)) throw new ValidationError(`Unknown action ${action}`);
  const article = await loadArticle(articleId);
  const ctx = await loadStoryContext(article.storyId);
  const aiCtx: AiServiceContext = { editionId: article.editionId, entityType: "ARTICLE", entityId: article.id, cacheable: false };
  const blocks = article.body as ArticleBlock[];
  let proposal: ArticleProposal;
  switch (action) {
    case "shorten": {
      const targetWords = options.targetWords ?? Math.round(article.wordCount * 0.8);
      const r = await copyEditArticle({ blocks, instruction: `Shorten the article to about ${targetWords} words. ${options.instruction ?? ""}`.trim(), targetWords }, aiCtx);
      proposal = { action, kind: "blocks", aiJobId: r.aiJobId, blocks: fromAiBlocks(r.output.blocks, blocks), changes: r.output.changes, costCents: r.usage.costCents };
      break;
    }
    case "improve_structure":
    case "improve_english": {
      const instruction = action === "improve_structure" ? `Improve the structure: logical order, crossheads where useful, one idea per paragraph. ${options.instruction ?? ""}` : `Improve the English: grammar, flow and house style, without changing meaning. ${options.instruction ?? ""}`;
      const r = await copyEditArticle({ blocks, instruction: instruction.trim() }, aiCtx);
      proposal = { action, kind: "blocks", aiJobId: r.aiJobId, blocks: fromAiBlocks(r.output.blocks, blocks), changes: r.output.changes, costCents: r.usage.costCents };
      break;
    }
    case "translate": {
      const r = await translateArticle({ blocks, targetLanguage: options.targetLanguage ?? (article.language === "fr" ? "en" : "fr") }, aiCtx);
      proposal = { action, kind: "blocks", aiJobId: r.aiJobId, blocks: fromAiBlocks(r.output.blocks, blocks), notes: r.output.notes, costCents: r.usage.costCents };
      break;
    }
    case "rewrite_headline":
    case "generate_headlines": {
      const count = action === "rewrite_headline" ? 1 : (options.count ?? 5);
      const r = await generateHeadlines({ storyType: ctx.story.storyType, title: ctx.story.title, facts: toDraftFacts(ctx.facts).filter((f) => f.status !== "DISPUTED").map((f) => ({ id: f.id, statement: f.statement, category: f.category })), currentHeadline: article.headline, count, company: ctx.bdd?.companyName ?? null, cohort: ctx.bdd?.cohortLabel ?? null, standfirst: article.standfirst }, aiCtx);
      const list = r.output.headlines.filter((h) => h.text.trim());
      proposal = action === "rewrite_headline" ? { action, kind: "headline", aiJobId: r.aiJobId, headline: list[0]?.text ?? article.headline, headlines: list, costCents: r.usage.costCents } : { action, kind: "headlines", aiJobId: r.aiJobId, headlines: list, costCents: r.usage.costCents };
      break;
    }
    case "suggest_pull_quote": {
      const r = await selectPullQuote({ quotes: ctx.quotes.map((q) => ({ id: q.id, text: q.text, speaker: q.speakerName, role: q.speakerRole })) }, aiCtx);
      const chosen = r.output.quoteId ? ctx.quotes.find((q) => q.id === r.output.quoteId) : null;
      proposal = { action, kind: "pullQuote", aiJobId: r.aiJobId, pullQuote: chosen ? { quoteId: chosen.id, text: r.output.text ?? chosen.text, attribution: chosen.speakerName } : null, reason: r.output.reason, costCents: r.usage.costCents };
      break;
    }
    case "check_consistency": {
      const r = await checkConsistency({ blocks, facts: ctx.facts.filter((f) => f.status !== "REJECTED").map((f) => ({ id: f.id, statement: f.statement, confidence: f.confidence, status: f.status })), quotes: ctx.quotes.map((q) => ({ id: q.id, text: q.text, speaker: q.speakerName })) }, aiCtx);
      const issues: WarningItem[] = r.output.issues.map((i) => ({ code: `CONSISTENCY_${i.type}`, message: `${i.explanation} (“${i.excerpt}”)`, severity: i.severity, entityId: i.blockId }));
      await storeWarnings(article, "CONSISTENCY_", issues);
      proposal = { action, kind: "issues", aiJobId: r.aiJobId, issues, verdict: r.output.verdict, costCents: r.usage.costCents };
      break;
    }
    case "check_house_style": {
      const r = await harmonizeTone({ blocks }, aiCtx);
      const proposed = fromAiBlocks(r.output.blocks, blocks);
      const issues: WarningItem[] = r.output.changes.filter((c) => !/already consistent/i.test(c)).map((c) => ({ code: "HOUSE_STYLE", message: c, severity: "info" as const, entityId: c.match(/^(b_[a-z0-9]+|seed_b\d+)/)?.[1] }));
      await storeWarnings(article, "HOUSE_STYLE", issues);
      proposal = { action, kind: "issues", aiJobId: r.aiJobId, issues, blocks: proposed, changes: r.output.changes, costCents: r.usage.costCents };
      break;
    }
  }
  await audit({ action: `article.ai.${action}`, userId, actorType: userId ? "USER" : "AI", entityType: "ARTICLE", entityId: articleId, editionId: article.editionId, metadata: { aiJobId: proposal.aiJobId, kind: proposal.kind, costCents: proposal.costCents } });
  return proposal;
}

async function storeWarnings(article: ArticleRow, prefix: string, issues: WarningItem[]) {
  const kept = article.warnings.filter((w) => !w.code.startsWith(prefix));
  await db.update(articles).set({ warnings: [...kept, ...issues] }).where(eq(articles.id, article.id));
}

export async function submitForReview(articleId: string, userId: string) {
  const article = await loadArticle(articleId);
  if (!["AI_DRAFT", "IN_EDITING"].includes(article.status)) throw new ValidationError(`An article in status ${article.status} cannot be submitted for review`);
  if (!article.headline.trim() || !article.body.length) throw new ValidationError("The article needs a headline and a body before review");
  const [row] = await db.update(articles).set({ status: "READY_FOR_REVIEW", lastEditedById: userId, lastEditedAt: new Date() }).where(eq(articles.id, articleId)).returning();
  await db.update(stories).set({ status: "IN_REVIEW" }).where(eq(stories.id, article.storyId));
  await recordDecision({ editionId: article.editionId, entityType: "ARTICLE", entityId: articleId, decision: "ARTICLE_SUBMIT_REVIEW", previousValue: { status: article.status }, newValue: { status: "READY_FOR_REVIEW" }, userId });
  await notifyRole(["EDITOR_IN_CHIEF", "EDITOR"], { type: "ARTICLE_READY", title: `Ready for review: ${article.headline}`, body: `${article.wordCount} words.`, entityType: "ARTICLE", entityId: articleId, href: `/articles/${articleId}` }, { excludeUserIds: [userId] });
  return row;
}

/** Approves an article. Disputed facts block approval unless forced with a reason (recorded as a decision). */
export async function approveArticle(articleId: string, userId: string, options: { force?: boolean; reason?: string | null } = {}) {
  const article = await loadArticle(articleId);
  if (article.status === "LOCKED") throw new ValidationError("The article is locked");
  if (!article.headline.trim() || !article.body.length) throw new ValidationError("The article needs a headline and a body");
  const disputed = await db.query.facts.findMany({ where: and(eq(facts.storyId, article.storyId), eq(facts.status, "DISPUTED")), columns: { id: true, statement: true } });
  if (disputed.length) {
    if (!options.force) throw new ValidationError(`${disputed.length} disputed fact(s) must be resolved before approval`, { facts: disputed.map((f) => f.statement) });
    if (!options.reason?.trim()) throw new ValidationError("A reason is required to approve with disputed facts", { reason: ["Required"] });
    await recordDecision({ editionId: article.editionId, entityType: "ARTICLE", entityId: articleId, decision: "ARTICLE_APPROVE_WITH_DISPUTED_FACTS", reason: options.reason, previousValue: { disputed: disputed.map((f) => f.id) }, newValue: { status: "APPROVED" }, userId });
  }
  const now = new Date();
  const [row] = await db.update(articles).set({ status: "APPROVED", approvedById: userId, approvedAt: now }).where(eq(articles.id, articleId)).returning();
  await db.update(stories).set({ status: "APPROVED" }).where(eq(stories.id, article.storyId));
  await recordDecision({ editionId: article.editionId, entityType: "ARTICLE", entityId: articleId, decision: "ARTICLE_APPROVE", reason: options.reason ?? null, previousValue: { status: article.status }, newValue: { status: "APPROVED" }, userId });
  return row;
}

export async function requestChanges(articleId: string, userId: string, note: string) {
  if (!note?.trim()) throw new ValidationError("A note is required", { note: ["Required"] });
  const article = await loadArticle(articleId);
  if (article.status === "LOCKED") throw new ValidationError("The article is locked");
  const [row] = await db.update(articles).set({ status: "IN_EDITING", approvedById: null, approvedAt: null }).where(eq(articles.id, articleId)).returning();
  await db.update(stories).set({ status: "DRAFTING" }).where(eq(stories.id, article.storyId));
  await addComment("ARTICLE", articleId, note, userId, article.editionId);
  await recordDecision({ editionId: article.editionId, entityType: "ARTICLE", entityId: articleId, decision: "ARTICLE_REQUEST_CHANGES", reason: note, previousValue: { status: article.status }, newValue: { status: "IN_EDITING" }, userId });
  const story = await db.query.stories.findFirst({ where: eq(stories.id, article.storyId), columns: { assignedToUserId: true } });
  const recipients = [article.lastEditedById, story?.assignedToUserId].filter((id): id is string => !!id && id !== userId);
  if (recipients.length) await notifyUsers(recipients, { type: "ARTICLE_READY", title: `Changes requested: ${article.headline}`, body: note.slice(0, 200), entityType: "ARTICLE", entityId: articleId, href: `/articles/${articleId}` });
  return row;
}

export async function lockArticle(articleId: string, userId: string) {
  const article = await loadArticle(articleId);
  if (article.status !== "APPROVED") throw new ValidationError("Only approved articles can be locked");
  const [row] = await db.update(articles).set({ status: "LOCKED", lockedAt: new Date() }).where(eq(articles.id, articleId)).returning();
  await recordDecision({ editionId: article.editionId, entityType: "ARTICLE", entityId: articleId, decision: "ARTICLE_LOCK", previousValue: { status: article.status }, newValue: { status: "LOCKED" }, userId });
  return row;
}

export async function unlockArticle(articleId: string, userId: string, reason?: string | null) {
  const article = await loadArticle(articleId);
  if (article.status !== "LOCKED") throw new ValidationError("The article is not locked");
  const [row] = await db.update(articles).set({ status: "APPROVED", lockedAt: null }).where(eq(articles.id, articleId)).returning();
  await recordDecision({ editionId: article.editionId, entityType: "ARTICLE", entityId: articleId, decision: "ARTICLE_UNLOCK", reason: reason ?? null, previousValue: { status: "LOCKED" }, newValue: { status: "APPROVED" }, userId });
  return row;
}

/** Article sources with the submission titles (used by the editor sidebar). */
export async function articleSourceList(articleId: string) {
  return db.query.articleSources.findMany({ where: eq(articleSources.articleId, articleId), with: { submission: { columns: { id: true, title: true, storyType: true, status: true, contributorId: true } } } });
}

