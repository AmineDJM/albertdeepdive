/**
 * End-to-end newsroom pipeline on the seeded test database, with the deterministic local AI provider:
 * submissions → clusters → story → article → explanations → information request → full edition run.
 * Fixture texts are the seed's own Carrefour B2 and Jonquille Run submissions.
 */
import { and, eq, inArray, ne } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { articleRevisions, articleSources, automationRuns, businessDeepDives, campuses, contributors, editionSections, editions, emailLog, facts, notifications, people, quotes, stories, storyClusterMembers, storyClusters, storyPeople, submissionCampuses, submissions, users } from "@/server/db/schema";
import { DEFAULT_SECTIONS } from "@/lib/constants";
import { clusterEdition, listClusters } from "@/server/editorial/clustering";
import { processSubmission, reviewSubmission } from "@/server/editorial/submissions";
import { createStoryFromCluster, editionStorySummary, storyOverview } from "@/server/editorial/stories";
import { approveArticle, draftArticle, revisions, runArticleAction, saveArticle } from "@/server/editorial/articles";
import { explainBlock, listFacts, resolveConflict } from "@/server/editorial/facts";
import { answerInformationRequest, createInformationRequest, resolveInformationRequest, suggestInformationRequest } from "@/server/editorial/information-requests";
import { addComment } from "@/server/editorial/comments";
import { listNotifications } from "@/server/editorial/notifications";
import { editionAiCost } from "@/server/editorial/cost";
import { processEdition } from "@/server/ai/pipeline";
import { ensureSeeded } from "../helpers/db";
import { BDD_STORIES } from "../../seed/stories-bdd";
import { CAMPUS_STORIES } from "../../seed/stories-campus";

const carrefour = BDD_STORIES.find((s) => s.key === "bdd-carrefour-b2")!;
const jonquille = CAMPUS_STORIES.find((s) => s.key === "campus-jonquille-run")!;
type SeedSub = (typeof carrefour.submissions)[number];

let seedEditionId: string;
let editorId: string;
let parisId: string;
const contributorByKey = new Map<string, typeof contributors.$inferSelect>();

async function contributor(email: string) {
  const row = await db.query.contributors.findFirst({ where: eq(contributors.email, email) });
  if (!row) throw new Error(`missing seed contributor ${email}`);
  return row;
}

async function createEdition(issueNumber: number, status: "CLOSED" | "OPEN" = "CLOSED") {
  const [edition] = await db.insert(editions).values({ issueNumber, title: `Test issue N°${issueNumber}`, slug: `test-issue-${issueNumber}`, label: `Test ${issueNumber}`, month: 9, year: 2026, status, targetPageCount: 24 }).returning();
  await db.insert(editionSections).values(DEFAULT_SECTIONS.map((sec, i) => ({ editionId: edition.id, slug: sec.slug, name: sec.name, kicker: sec.kicker, colour: sec.colour, sortOrder: i, targetPages: sec.targetPages })));
  return edition;
}

async function insertSubmission(editionId: string, sub: SeedSub, minutesOffset: number) {
  const c = contributorByKey.get(sub.contributor)!;
  const createdAt = new Date(Date.now() - (60 - minutesOffset) * 60_000);
  const [row] = await db
    .insert(submissions)
    .values({
      editionId,
      contributorId: c.id,
      storyType: sub.storyType as typeof submissions.$inferInsert.storyType,
      title: sub.title,
      campusScope: "SINGLE",
      eventDateText: sub.eventDateText ?? null,
      description: sub.description,
      peopleInvolved: sub.peopleInvolved ?? null,
      organisationsInvolved: sub.organisationsInvolved ?? null,
      whyItMatters: sub.whyItMatters ?? null,
      quotes: sub.quotes ?? null,
      urls: sub.urls ?? [],
      contactName: `${c.firstName} ${c.lastName}`,
      contactEmail: c.email,
      extra: sub.extra ?? {},
      status: "NEW",
      source: "form",
      publicationConsent: true,
      imageRightsConfirmed: true,
      submittedAt: createdAt,
      createdAt,
    })
    .returning();
  await db.insert(submissionCampuses).values({ submissionId: row.id, campusId: parisId });
  return row;
}

beforeAll(async () => {
  const seeded = await ensureSeeded();
  seedEditionId = seeded.editionId;
  editorId = (await db.query.users.findFirst({ where: eq(users.email, "editor@albertschool.com") }))!.id;
  parisId = (await db.query.campuses.findFirst({ where: eq(campuses.slug, "paris") }))!.id;
  for (const [key, email] of [["khadidja", "khadidja.addi@example.com"], ["sacha", "sacha.nardoux@example.com"], ["simon", "simon.flasaquier@example.com"], ["milan", "milan.viallet@example.com"]] as const) {
    contributorByKey.set(key, await contributor(email));
  }
});

describe("pipeline on a fresh edition", () => {
  let editionId: string;
  const subIds: Record<string, string> = {};
  let carrefourClusterId: string;
  let jonquilleClusterId: string;
  let storyId: string;
  let articleId: string;

  beforeAll(async () => {
    const edition = await createEdition(90);
    editionId = edition.id;
    subIds.khadidja = (await insertSubmission(editionId, carrefour.submissions[0], 1)).id;
    subIds.sacha = (await insertSubmission(editionId, carrefour.submissions[1], 2)).id;
    subIds.simon = (await insertSubmission(editionId, carrefour.submissions[2], 3)).id;
    subIds.milan = (await insertSubmission(editionId, jonquille.submissions[0], 4)).id;
  });

  it("processes submissions: normalised text, classification, entities, importance, no false duplicates", async () => {
    for (const id of Object.values(subIds)) {
      const r = await processSubmission(id);
      expect(r.skipped).toBe(false);
      expect(r.status).toBe("NEEDS_REVIEW");
      expect(r.duplicateOfId).toBeNull();
      expect(r.aiJobIds).toHaveLength(3);
    }
    const sacha = (await db.query.submissions.findFirst({ where: eq(submissions.id, subIds.sacha) }))!;
    expect(sacha.storyType).toBe("BUSINESS_DEEP_DIVE");
    expect(sacha.normalizedText).toContain("Winning team: Enzo Natali, Nathan Serfaty, Sacha Nardoux");
    expect(sacha.aiClassification?.sectionSlug).toBe("bdd");
    expect(sacha.suggestedSectionSlug).toBe("bdd");
    expect(sacha.aiEntities?.people?.map((p) => p.name)).toEqual(expect.arrayContaining(["Enzo Natali", "Nathan Serfaty", "Sacha Nardoux"]));
    expect(sacha.aiEntities?.metrics?.some((m) => m.value === "0.4%")).toBe(true);
    expect(sacha.aiImportance).toBeGreaterThan(0.5);
    expect(sacha.processedAt).not.toBeNull();
    const milan = (await db.query.submissions.findFirst({ where: eq(submissions.id, subIds.milan) }))!;
    expect(milan.storyType).toBe("EVENT_RECAP");
    expect(milan.aiWarnings.map((w) => w.code)).toContain("NO_MEDIA");
    // Idempotent: a second call is skipped unless forced.
    expect((await processSubmission(subIds.milan)).skipped).toBe(true);
    expect((await processSubmission(subIds.milan, { force: true })).skipped).toBe(false);
  });

  it("clusters the three Carrefour submissions together and the Jonquille Run separately", async () => {
    const result = await clusterEdition(editionId);
    expect(result.considered).toBe(4);
    expect(result.created).toHaveLength(2);
    expect(result.groups).toBe(2);
    const clusters = await listClusters(editionId);
    expect(clusters).toHaveLength(2);
    const carrefourCluster = clusters.find((c) => c.members.some((m) => m.submissionId === subIds.khadidja))!;
    const jonquilleCluster = clusters.find((c) => c.members.some((m) => m.submissionId === subIds.milan))!;
    carrefourClusterId = carrefourCluster.id;
    jonquilleClusterId = jonquilleCluster.id;
    expect(carrefourCluster.members.map((m) => m.submissionId).sort()).toEqual([subIds.khadidja, subIds.sacha, subIds.simon].sort());
    expect(jonquilleCluster.members.map((m) => m.submissionId)).toEqual([subIds.milan]);
    expect(carrefourCluster.title).toBe("Carrefour – B2 Paris");
    expect(carrefourCluster.primaryStoryType).toBe("BUSINESS_DEEP_DIVE");
    expect(carrefourCluster.suggestedSectionSlug).toBe("bdd");
    expect(carrefourCluster.submissionCount).toBe(3);
    expect(carrefourCluster.factSheet.length).toBeGreaterThan(8);
    expect(carrefourCluster.factSheet.some((f) => f.confidence === "CONFLICTING")).toBe(true);
    expect(carrefourCluster.warnings.map((w) => w.code)).toContain("NAME_MISMATCH");
    expect(carrefourCluster.warnings.find((w) => w.code === "NAME_MISMATCH")?.message).toContain("Khadidja Addi");
    expect(carrefourCluster.aiScoreTotal).toBeGreaterThan(50);
    expect(carrefourCluster.missingInformation.map((m) => m.key)).toContain("logo");
    expect(carrefourCluster.quoteCount).toBeGreaterThanOrEqual(2);
    const clusterQuotes = await db.query.quotes.findMany({ where: eq(quotes.clusterId, carrefourClusterId) });
    expect(clusterQuotes.find((q) => q.text.startsWith("Our model predicts"))?.speakerName).toBe("Sacha Nardoux");
    expect(clusterQuotes.find((q) => q.text.startsWith("I'm very pleased"))?.speakerName).toBe("Sacha Nardoux");
    const members = await db.query.submissions.findMany({ where: inArray(submissions.id, Object.values(subIds)) });
    expect(members.every((m) => m.suggestedClusterId !== null)).toBe(true);
    expect(jonquilleCluster.title).toBe(jonquille.submissions[0].title);
  });

  it("re-running the clustering reuses the clusters instead of duplicating them", async () => {
    const again = await clusterEdition(editionId);
    expect(again.created).toHaveLength(0);
    expect(again.updated.sort()).toEqual([carrefourClusterId, jonquilleClusterId].sort());
    expect(again.dismissed).toHaveLength(0);
    const clusters = await listClusters(editionId);
    expect(clusters.map((c) => c.status)).toEqual(["PROPOSED", "PROPOSED"]);
    expect(await db.query.quotes.findMany({ where: eq(quotes.clusterId, carrefourClusterId) })).toHaveLength(clusters.find((c) => c.id === carrefourClusterId)!.quoteCount);
  });

  it("creates the story with facts, quotes, people, organisations and the BDD satellite (idempotently)", async () => {
    const story = await createStoryFromCluster(carrefourClusterId, { userId: editorId });
    storyId = story.id;
    expect(story.storyType).toBe("BUSINESS_DEEP_DIVE");
    expect(story.slug).toBe("carrefour-b2-paris");
    expect(story.status).toBe("CANDIDATE");
    expect(story.suggestedTemplate).toBe("BDD_CASE");
    expect(["MEDIUM", "LONG"]).toContain(story.targetLength);
    expect((await createStoryFromCluster(carrefourClusterId)).id).toBe(storyId);
    const storyFacts = await listFacts(storyId);
    expect(storyFacts.length).toBeGreaterThan(8);
    expect(storyFacts.filter((f) => f.status === "DISPUTED")).toHaveLength(1);
    expect(storyFacts.every((f) => f.sourceSubmissionId && Object.values(subIds).includes(f.sourceSubmissionId))).toBe(true);
    const storyQuotes = await db.query.quotes.findMany({ where: eq(quotes.storyId, storyId) });
    expect(storyQuotes.length).toBeGreaterThanOrEqual(2);
    const peopleRows = await db.select({ name: people.fullName, role: storyPeople.role }).from(storyPeople).innerJoin(people, eq(people.id, storyPeople.personId)).where(eq(storyPeople.storyId, storyId));
    expect(peopleRows.map((p) => p.name)).toEqual(expect.arrayContaining(["Enzo Natali", "Nathan Sarfaty", "Sacha Nardoux", "Lucile Garzon", "Nicolas Treanton"]));
    expect(peopleRows.find((p) => p.name === "Lucile Garzon")?.role).toBe("JURY");
    const bdd = (await db.query.businessDeepDives.findFirst({ where: eq(businessDeepDives.storyId, storyId) }))!;
    expect(bdd.companyName).toBe("Carrefour");
    expect(bdd.cohortLabel).toBe("B2 Paris");
    expect(bdd.programCode).toBe("B2");
    expect(bdd.campusId).toBe(parisId);
    expect(bdd.winningTeam.map((m) => m.name)).toEqual(["Enzo Natali", "Nathan Sarfaty", "Sacha Nardoux"]);
    expect(bdd.jury.map((j) => j.name)).toEqual(["Lucile Garzon", "Nicolas Treanton"]);
    expect(bdd.theResults).toBe("+0.4% estimated sales per shop");
    expect(bdd.technologies).toEqual(["LightGBM", "Python", "dashboard"]);
    expect(bdd.metrics[0]?.value).toBe("+0.4%");
    const overview = await storyOverview(storyId);
    expect(overview.article?.status).toBe("EMPTY");
    expect(overview.submissions).toHaveLength(3);
    expect(overview.submissions[0].id).toBe(subIds.sacha);
    expect(overview.organisations.map((o) => o.organisation.name)).toContain("Carrefour");
    expect(overview.disputedFacts).toBe(1);
  });

  it("drafts the article with sourced blocks, provenance, headline alternatives and a revision", async () => {
    const result = await draftArticle(storyId, { userId: editorId });
    articleId = result.article.id;
    const article = result.article;
    expect(article.status).toBe("AI_DRAFT");
    expect(article.headline).toBe("Carrefour – B2 Paris");
    expect(article.kicker).toBe("Carrefour – B2 Paris");
    expect(article.headlineAlternatives.length).toBeGreaterThanOrEqual(3);
    expect(article.standfirst).toBeTruthy();
    expect(article.byline).toBe("Sacha Nardoux");
    expect(article.body.length).toBeGreaterThan(6);
    expect(article.body.some((b) => b.type === "crosshead" && b.text === "THE CASE")).toBe(true);
    expect(article.body.some((b) => b.type === "pullquote")).toBe(true);
    expect(article.body.some((b) => b.type === "testimony" && b.speaker === "Sacha Nardoux")).toBe(true);
    for (const b of article.body) {
      if (b.type === "paragraph" || b.type === "testimony" || b.type === "list" || b.type === "box") {
        expect(b.sources?.length, `${b.type} ${b.id} has sources`).toBeGreaterThan(0);
        expect(b.sources!.every((s) => Object.values(subIds).includes(s))).toBe(true);
        expect(article.provenance[b.id]).toBeDefined();
      }
    }
    expect(article.wordCount).toBeGreaterThan(150);
    expect(article.warnings.some((w) => w.code === "AI_CAUTION")).toBe(true);
    expect(result.revision.version).toBe(1);
    expect(result.revision.createdByAi).toBe(true);
    expect(result.revision.aiJobId).toBeTruthy();
    const sources = await db.query.articleSources.findMany({ where: eq(articleSources.articleId, articleId) });
    expect(sources.map((s) => s.role).sort()).toEqual(["PHOTO", "PRIMARY", "PRIMARY"]);
    expect((await db.query.stories.findFirst({ where: eq(stories.id, storyId) }))!.status).toBe("DRAFTING");
    expect(result.aiJobIds.length).toBeGreaterThanOrEqual(4);
  });

  it("explains why a block is there with its supporting facts and submissions", async () => {
    const article = (await db.query.articles.findFirst({ where: eq(stories.id, storyId) }).catch(() => null)) ?? (await db.query.articles.findFirst({ where: eq(articleSources.articleId, articleId) }).catch(() => null));
    const paragraph = (article ?? (await db.query.articles.findFirst({ where: eq(articleRevisions.articleId, articleId) }).catch(() => null)))?.body.find((b) => b.type === "paragraph");
    const first = paragraph ?? (await db.query.articles.findMany()).find((a) => a.id === articleId)!.body.find((b) => b.type === "paragraph")!;
    const explanation = await explainBlock(articleId, first.id);
    expect(explanation.block?.id).toBe(first.id);
    expect(explanation.facts.length).toBeGreaterThan(0);
    expect(explanation.submissions.length).toBeGreaterThan(0);
    expect(explanation.submissions[0].contributorName).toBeTruthy();
    expect(explanation.submissions.some((s) => s.excerpt)).toBe(true);
    const missing = await explainBlock(articleId, "does-not-exist");
    expect(missing.block).toBeNull();
    expect(missing.note).toContain("no longer exists");
  });

  it("runs assistant actions as proposals without touching the body, and stores consistency warnings", async () => {
    const before = (await db.query.articles.findMany()).find((a) => a.id === articleId)!;
    const consistency = await runArticleAction(articleId, "check_consistency", editorId);
    expect(consistency.kind).toBe("issues");
    expect(consistency.issues?.some((i) => i.code === "CONSISTENCY_NAME_MISMATCH")).toBe(true);
    const after = (await db.query.articles.findMany()).find((a) => a.id === articleId)!;
    expect(after.body).toEqual(before.body);
    expect(after.warnings.some((w) => w.code === "CONSISTENCY_NAME_MISMATCH")).toBe(true);
    const headlines = await runArticleAction(articleId, "generate_headlines", editorId, { count: 3 });
    expect(headlines.kind).toBe("headlines");
    expect(headlines.headlines!.length).toBeGreaterThanOrEqual(2);
    const shorten = await runArticleAction(articleId, "shorten", editorId, { targetWords: 120 });
    expect(shorten.kind).toBe("blocks");
    expect(shorten.blocks!.length).toBeGreaterThan(0);
    const pull = await runArticleAction(articleId, "suggest_pull_quote", editorId);
    expect(pull.pullQuote?.attribution).toBe("Sacha Nardoux");
    expect((await db.query.articles.findMany()).find((a) => a.id === articleId)!.headline).toBe(before.headline);
  });

  it("saves editor changes as a new revision with a manual edit ratio, and gates approval on disputed facts", async () => {
    const current = (await db.query.articles.findMany()).find((a) => a.id === articleId)!;
    const body = current.body.map((b) => (b.type === "paragraph" ? { ...b, text: `${b.text} Well done to them!` } : b));
    const saved = await saveArticle(articleId, { headline: "Pet food, two LightGBM models and a +0.4% sales uplift per shop", body }, editorId);
    expect(saved.article.status).toBe("IN_EDITING");
    expect(saved.article.currentRevision).toBe(2);
    expect(saved.article.manualEditRatio).toBeGreaterThan(0);
    expect(saved.article.manualEditRatio).toBeLessThan(0.5);
    expect((await revisions(articleId)).map((r) => r.version)).toEqual([2, 1]);
    await expect(approveArticle(articleId, editorId)).rejects.toThrow(/disputed/);
    const disputed = (await listFacts(storyId)).find((f) => f.status === "DISPUTED")!;
    const resolved = await resolveConflict(disputed.id, disputed.id, "Khadidja confirmed the spelling Sarfaty with the student.", editorId);
    expect(resolved.kept.status).toBe("RESOLVED");
    const approved = await approveArticle(articleId, editorId);
    expect(approved.status).toBe("APPROVED");
    expect(approved.approvedById).toBe(editorId);
    expect((await db.query.stories.findFirst({ where: eq(stories.id, storyId) }))!.status).toBe("APPROVED");
  });

  it("sends an information request by email and records the contributor's answers as a follow-up submission", async () => {
    const suggestion = await suggestInformationRequest(storyId);
    expect(suggestion.contributor?.id).toBe(contributorByKey.get("sacha")!.id);
    expect(suggestion.items.map((i) => i.key)).toContain("logo");
    const khadidja = contributorByKey.get("khadidja")!;
    const created = await createInformationRequest({ storyId, submissionId: subIds.khadidja, contributorId: khadidja.id, items: [{ key: "logo", label: "Can you share the company logo?" }, { key: "jury", label: "What are the jury members' roles at Carrefour?" }], message: "Two quick questions before we go to print.", userId: editorId });
    expect(created.request.status).toBe("SENT");
    expect(created.url).toContain("/respond/");
    const mail = await db.query.emailLog.findFirst({ where: and(eq(emailLog.template, "information_request"), eq(emailLog.to, khadidja.email)) });
    expect(mail?.status).toBe("LOGGED");
    expect(mail?.html).toContain(created.url);
    expect(mail?.subject).toContain("Carrefour – B2 Paris");
    expect(mail?.textBody).toContain("Can you share the company logo?");
    expect((await resolveInformationRequest(created.token)).state).toBe("valid");
    expect((await resolveInformationRequest("not-a-real-token-value")).state).toBe("invalid");
    const answered = await answerInformationRequest(created.token, { answers: { logo: "The logo is on the shared drive, folder Carrefour." }, freeText: "The jury members work in the pet food category." });
    expect(answered.request.status).toBe("ANSWERED");
    expect(answered.answeredKeys).toEqual(["logo"]);
    expect(answered.submission.source).toBe("info_request");
    expect(answered.submission.status).toBe("NEEDS_REVIEW");
    expect(answered.submission.description).toContain("The logo is on the shared drive");
    const membership = await db.query.storyClusterMembers.findFirst({ where: and(eq(storyClusterMembers.clusterId, carrefourClusterId), eq(storyClusterMembers.submissionId, answered.submission.id)) });
    expect(membership).toBeDefined();
    const story = (await db.query.stories.findFirst({ where: eq(stories.id, storyId) }))!;
    expect(story.missingInformation.find((m) => m.key === "logo")?.resolved).toBe(true);
    expect((await resolveInformationRequest(created.token)).state).toBe("answered");
    await expect(answerInformationRequest(created.token, { answers: { logo: "again" } })).rejects.toThrow(/already/);
    const notes = await listNotifications(editorId, { unreadOnly: true });
    expect(notes.some((n) => n.type === "MISSING_INFORMATION" && n.title.includes("answered"))).toBe(true);
  });

  it("records comments with mentions and reports AI cost by service", async () => {
    const eic = (await db.query.users.findFirst({ where: eq(users.email, "eic@albertschool.com") }))!;
    const { comment, mentions } = await addComment("STORY", storyId, `@${eic.id} can you check the Sarfaty spelling?`, editorId, editionId);
    expect(mentions).toEqual([eic.id]);
    expect(comment.mentions).toEqual([eic.id]);
    const mention = await db.query.notifications.findFirst({ where: and(eq(notifications.userId, eic.id), eq(notifications.type, "MENTION")) });
    expect(mention?.entityId).toBe(storyId);
    const cost = await editionAiCost(editionId);
    expect(cost.calls).toBeGreaterThan(10);
    expect(cost.byService.map((s) => s.service)).toEqual(expect.arrayContaining(["normalizer", "classifier", "fact_sheet", "article_drafter"]));
    expect(cost.byModel[0]?.model).toBe("local-deterministic");
    const summary = await editionStorySummary(editionId);
    expect(summary.total).toBe(1);
    expect(summary.byType.BUSINESS_DEEP_DIVE).toBe(1);
    expect(summary.articlesByStatus.APPROVED).toBe(1);
    await reviewSubmission(subIds.milan, { status: "ACCEPTED", note: "Nice recap", userId: editorId });
    expect((await db.query.submissions.findFirst({ where: eq(submissions.id, subIds.milan) }))!.status).toBe("ACCEPTED");
  });
});

describe("processEdition", () => {
  it("runs the whole pipeline idempotently on a fresh edition", async () => {
    const edition = await createEdition(91);
    for (const [i, sub] of [...carrefour.submissions, jonquille.submissions[0]].entries()) await insertSubmission(edition.id, sub, i + 1);
    const first = await processEdition(edition.id, { triggeredBy: "MANUAL", userId: editorId });
    expect(first.status).toBe("EDITORIAL_REVIEW");
    expect(first.submissionsProcessed).toBe(4);
    expect(first.submissionsFailed).toHaveLength(0);
    expect(first.clustering?.created).toHaveLength(2);
    expect(first.storiesCreated).toBe(2);
    expect(first.sectionPlan?.planned).toBe(2);
    expect(first.notifications.processingCompleted).toBeGreaterThan(0);
    expect(first.notifications.factualConflict).toBeGreaterThan(0);
    expect((await db.query.editions.findFirst({ where: eq(editions.id, edition.id) }))!.status).toBe("EDITORIAL_REVIEW");
    const run = await db.query.automationRuns.findFirst({ where: eq(automationRuns.runKey, `${edition.id}:AI_PROCESSING`) });
    expect(run?.status).toBe("SUCCEEDED");
    expect(run?.triggeredBy).toBe("MANUAL");
    const storiesAfterFirst = await db.query.stories.findMany({ where: eq(stories.editionId, edition.id) });
    expect(storiesAfterFirst.every((s) => s.sectionId !== null && s.suggestedTemplate)).toBe(true);
    expect(storiesAfterFirst.find((s) => s.storyType === "BUSINESS_DEEP_DIVE")?.aiNotes.some((n) => n.includes("suggested cover story"))).toBe(true);

    const second = await processEdition(edition.id, { triggeredBy: "MANUAL" });
    expect(second.status).toBe("EDITORIAL_REVIEW");
    expect(second.submissionsProcessed).toBe(0);
    expect(second.clustering?.created).toHaveLength(0);
    expect(second.clustering?.dismissed).toHaveLength(0);
    expect(second.storiesCreated).toBe(0);
    expect(await db.query.storyClusters.findMany({ where: eq(storyClusters.editionId, edition.id) })).toHaveLength(2);
    expect(await db.query.stories.findMany({ where: eq(stories.editionId, edition.id) })).toHaveLength(2);
    expect((await db.query.automationRuns.findMany({ where: eq(automationRuns.editionId, edition.id) })).filter((r) => r.step === "AI_PROCESSING")).toHaveLength(1);
  });

  it("refuses editions that cannot move to PROCESSING", async () => {
    const edition = await createEdition(92, "OPEN");
    await expect(processEdition(edition.id)).rejects.toThrow(/cannot move/);
    expect((await db.query.automationRuns.findFirst({ where: eq(automationRuns.runKey, `${edition.id}:AI_PROCESSING`) }))?.status).toBe("FAILED");
  });
});

describe("duplicates against the seeded May 2025 issue", () => {
  it("flags a re-submitted seed text as DUPLICATE and attaches it to the confirmed cluster on clustering", async () => {
    const copy = await insertSubmission(seedEditionId, carrefour.submissions[0], 59);
    // The copy carries the same title, so it must be excluded or findFirst may return the copy itself.
    const original = await db.query.submissions.findFirst({ where: and(eq(submissions.editionId, seedEditionId), eq(submissions.title, carrefour.submissions[0].title), ne(submissions.id, copy.id)) });
    const result = await processSubmission(copy.id);
    expect(result.status).toBe("DUPLICATE");
    expect(result.duplicateOfId).toBe(original!.id);
    const before = await db.query.storyClusters.findMany({ where: eq(storyClusters.editionId, seedEditionId) });
    const clustering = await clusterEdition(seedEditionId);
    expect(clustering.attachedDuplicates).toBe(1);
    expect(clustering.created).toHaveLength(0);
    const after = await db.query.storyClusters.findMany({ where: eq(storyClusters.editionId, seedEditionId) });
    expect(after.length).toBe(before.length);
    const membership = await db.query.storyClusterMembers.findFirst({ where: eq(storyClusterMembers.submissionId, copy.id) });
    expect(membership?.clusterId).toBe(original!.suggestedClusterId);
    expect((await db.query.facts.findMany({ where: eq(facts.editionId, seedEditionId) })).length).toBeGreaterThan(0);
  });
});
