import { describe, expect, it } from "vitest";
import { generateLocal } from "@/server/ai/providers/local-generators";
import * as S from "@/server/ai/services";
import type { ProviderRequest } from "@/server/ai/types";
import { extractNameCandidates, looksLikePersonName } from "@/lib/editorial/text";
import { BDD_STORIES } from "../../seed/stories-bdd";
import { CAMPUS_STORIES } from "../../seed/stories-campus";
import { FEATURE_STORIES } from "../../seed/stories-features";

const req = (service: string, input: Record<string, unknown>): ProviderRequest => ({ system: "", user: "", model: "local-deterministic", temperature: 0, maxOutputTokens: 0, schema: {}, schemaName: service, hints: { service, input } });

const carrefour = BDD_STORIES.find((s) => s.key === "bdd-carrefour-b2")!;
const jonquille = CAMPUS_STORIES.find((s) => s.key === "campus-jonquille-run")!;
const ithier = FEATURE_STORIES.find((s) => s.key === "spotlight-ithier")!;
const party = CAMPUS_STORIES.find((s) => s.key === "event-admitted-party")!;

type SeedSub = (typeof carrefour.submissions)[number];

function normalize(sub: SeedSub, id: string) {
  const out = S.normalizerSchema.parse(generateLocal(req("normalizer", { storyType: sub.storyType, campus: "Paris", title: sub.title, description: sub.description, peopleInvolved: sub.peopleInvolved ?? "", organisationsInvolved: sub.organisationsInvolved ?? "", whyItMatters: sub.whyItMatters ?? "", quotes: sub.quotes ?? "", eventDateText: sub.eventDateText ?? "", extra: sub.extra ?? {} })));
  return { id, title: sub.title, text: out.normalizedText, storyType: sub.storyType, contributor: sub.contributor, quotes: sub.quotes ?? null, summary: out.summary };
}

/** Every person name in the output must literally appear in the input (the local provider never invents). */
function assertNoInventedNames(input: unknown, output: unknown) {
  const inputText = JSON.stringify(input);
  // Un-escape the JSON so the extractor sees real line breaks: a name never spans two lines.
  const names = extractNameCandidates(JSON.stringify(output).replace(/\\n/g, "\n").replace(/\\"/g, '"')).map((c) => c.name).filter(looksLikePersonName);
  for (const name of names) expect(inputText, `invented name: ${name}`).toContain(name);
}

const subs = carrefour.submissions.map((s, i) => normalize(s, `sub${i}`));

describe("local provider: ingestion services", () => {
  it("normalises without adding facts and detects the language", () => {
    const input = { storyType: "BUSINESS_DEEP_DIVE", campus: "Paris", title: carrefour.submissions[0].title, description: carrefour.submissions[0].description, peopleInvolved: carrefour.submissions[0].peopleInvolved, extra: carrefour.submissions[0].extra };
    const out = S.normalizerSchema.parse(generateLocal(req("normalizer", input)));
    expect(out.normalizedText).toContain("Enzo Natali, Nathan Sarfaty and Sacha Nardoux");
    expect(out.normalizedText).toContain("Winning team: Enzo Natali, Nathan Sarfaty, Sacha Nardoux");
    expect(out.summary.split(/\s+/).length).toBeLessThanOrEqual(60);
    expect(out.language).toBe("en");
    expect(out.wordCount).toBeGreaterThan(50);
    assertNoInventedNames(input, out);
  });

  it("classifies with the declared type as a prior but lets keywords override OTHER", () => {
    const bdd = S.classifierSchema.parse(generateLocal(req("classifier", { text: subs[1].text, declaredType: "BUSINESS_DEEP_DIVE", sectionSlugs: ["cover", "bdd", "campus-life"] })));
    expect(bdd.storyType).toBe("BUSINESS_DEEP_DIVE");
    expect(bdd.sectionSlug).toBe("bdd");
    expect(bdd.confidence).toBeGreaterThan(0.6);
    const run = S.classifierSchema.parse(generateLocal(req("classifier", { text: normalize(jonquille.submissions[0], "j").text, declaredType: "OTHER", sectionSlugs: ["bdd", "campus-life", "events"] })));
    expect(run.storyType).toBe("EVENT_RECAP");
    expect(run.sectionSlug).toBe("campus-life");
    expect(run.tags.length).toBeGreaterThanOrEqual(3);
  });

  it("extracts only entities that appear in the text, with roles from context", () => {
    const out = S.entitiesSchema.parse(generateLocal(req("entity_extractor", { text: subs[0].text, knownOrganisations: ["Carrefour"] })));
    expect(out.people.map((p) => p.name)).toEqual(expect.arrayContaining(["Enzo Natali", "Nathan Sarfaty", "Sacha Nardoux", "Lucile Garzon", "Nicolas Treanton"]));
    expect(out.people.find((p) => p.name === "Lucile Garzon")?.role).toBe("JURY");
    expect(out.people.find((p) => p.name === "Enzo Natali")?.role).toBe("WINNER");
    expect(out.organisations.map((o) => o.name)).toContain("Carrefour");
    expect(out.dates[0]?.text).toBe("Friday 4 April");
    expect(out.places).toContain("Paris");
    assertNoInventedNames(subs[0], out);
  });
});

describe("local provider: organisation services", () => {
  const name = S.clusterNameSchema.parse(generateLocal(req("cluster_namer", { submissionList: subs })));
  const sheet = S.factSheetSchema.parse(generateLocal(req("fact_sheet", { submissionList: subs })));

  it("names a BDD cluster Company – Cohort and reports the spelling contradiction", () => {
    expect(name.title).toBe("Carrefour – B2 Paris");
    expect(name.primaryStoryType).toBe("BUSINESS_DEEP_DIVE");
    expect(name.contradictions).toEqual([expect.objectContaining({ statementA: "Nathan Sarfaty", statementB: "Nathan Serfaty", submissionIds: ["sub0", "sub1"] })]);
    assertNoInventedNames(subs, name);
  });

  it("builds a sourced fact sheet with verbatim quotes and a CONFLICTING name fact", () => {
    expect(sheet.facts.length).toBeGreaterThan(8);
    const conflicting = sheet.facts.filter((f) => f.confidence === "CONFLICTING");
    expect(conflicting).toHaveLength(1);
    expect(conflicting[0].statement).toContain("Sarfaty");
    expect(conflicting[0].statement).toContain("Serfaty");
    expect(conflicting[0].sourceSubmissionIds).toEqual(["sub0", "sub1"]);
    const metric = sheet.facts.find((f) => f.category === "metric" && f.statement.includes("0.4%"));
    expect(metric?.sourceSubmissionIds).toEqual(["sub1"]);
    expect(sheet.facts.some((f) => f.confidence === "VERIFIED_BY_SUBMISSION" && f.sourceSubmissionIds.length >= 2)).toBe(true);
    const attributed = sheet.quotes.find((q) => q.speakerName === "Sacha Nardoux");
    expect(attributed?.text).toBe("Our model predicts an estimated increase in sales of 0.4% per shop, while perfectly respecting the initial assortment constraints.");
    for (const q of sheet.quotes) expect(subs.map((s) => s.text).join("\n")).toContain(q.text);
    assertNoInventedNames(subs, sheet);
  });

  it("scores relevance from the story type and counts", () => {
    const out = S.relevanceSchema.parse(generateLocal(req("relevance_scorer", { title: name.title, storyType: "BUSINESS_DEEP_DIVE", campuses: ["Paris"], campusScope: "SINGLE", summary: name.summary, sourceCount: 3, mediaCount: 4, quoteCount: 2 })));
    expect(out.businessDataRelevance).toBeGreaterThan(80);
    expect(out.visualRichness).toBeGreaterThan(out.businessDataRelevance - 20);
    const photoLess = S.relevanceSchema.parse(generateLocal(req("relevance_scorer", { title: "x", storyType: "ANECDOTE", campuses: [], summary: "", sourceCount: 1, mediaCount: 0, quoteCount: 0 })));
    expect(photoLess.visualRichness).toBeLessThan(out.visualRichness);
    expect(photoLess.businessDataRelevance).toBeLessThan(30);
  });

  it("asks only for what is genuinely missing", () => {
    const full = S.missingInfoSchema.parse(generateLocal(req("missing_info", { storyType: "BUSINESS_DEEP_DIVE", title: name.title, factList: sheet.facts, text: subs.map((s) => s.text).join("\n"), extra: { ...carrefour.submissions[0].extra, ...carrefour.submissions[1].extra }, mediaCount: 3, mediaKinds: ["photo", "screenshot"], quoteCount: 2, urls: [] })));
    expect(full.items.map((i) => i.key)).toEqual(["logo"]);
    const empty = S.missingInfoSchema.parse(generateLocal(req("missing_info", { storyType: "UPCOMING_EVENT", title: "Party", factList: [], text: "We are throwing a party for admitted students.", extra: {}, mediaCount: 0, mediaKinds: [], quoteCount: 0, urls: [] })));
    expect(empty.items.map((i) => i.key)).toEqual(expect.arrayContaining(["date", "place", "signup_link", "photo"]));
    expect(empty.items.find((i) => i.key === "signup_link")?.severity).toBe("high");
  });
});

describe("local provider: writing services", () => {
  const sheet = S.factSheetSchema.parse(generateLocal(req("fact_sheet", { submissionList: subs })));
  const facts = sheet.facts.map((f, i) => ({ id: `f${i}`, statement: f.statement, category: f.category, confidence: f.confidence, status: f.confidence === "CONFLICTING" ? "DISPUTED" : "ACTIVE", sourceSubmissionId: f.sourceSubmissionIds[0] }));
  const quotes = sheet.quotes.map((q, i) => ({ id: `q${i}`, text: q.text, speaker: q.speakerName ?? (q.sourceSubmissionId === "sub1" ? "Sacha Nardoux" : null), role: null, sourceSubmissionId: q.sourceSubmissionId }));
  const drafterInput = { storyType: "BUSINESS_DEEP_DIVE", targetLength: "LONG", targetWords: 600, title: "Carrefour – B2 Paris", campuses: ["Paris"], factList: facts, quoteList: quotes, submissions: subs.map((s) => ({ ...s, contributor: s.id === "sub1" ? "Sacha Nardoux" : "Khadidja Addi" })) };
  const draft = S.articleDraftSchema.parse(generateLocal(req("article_drafter", drafterInput)));

  it("drafts a BDD with the house crossheads, cited paragraphs, a testimony and a nutshell box", () => {
    const crossheads = draft.blocks.filter((b) => b.type === "crosshead").map((b) => (b as { text: string }).text);
    // House order for a Business Deep Dive (docs/EDITORIAL_DNA.md and the article_drafter prompt).
    expect(crossheads.slice(0, 5)).toEqual(["THE CASE", "THE DATA", "THE CHALLENGE", "THE APPROACH", "THE RESULTS"]);
    expect(crossheads).toContain("THE WINNING TEAM");
    const paragraphs = draft.blocks.filter((b) => b.type === "paragraph") as { text: string; factIds: string[] }[];
    expect(paragraphs.length).toBeGreaterThan(3);
    for (const p of paragraphs) expect(p.factIds.length, p.text).toBeGreaterThan(0);
    const testimonies = draft.blocks.filter((b) => b.type === "testimony") as { speaker: string | null; text: string | null; quoteId: string | null }[];
    expect(testimonies.some((t) => t.speaker === "Sacha Nardoux" && t.text?.startsWith("I'm very pleased"))).toBe(true);
    const box = draft.blocks.find((b) => b.type === "box") as { title: string; items: string[] } | undefined;
    expect(box?.title).toBe("In a nutshell");
    expect(box?.items.length).toBeGreaterThanOrEqual(3);
    expect(draft.cautions.join(" ")).toContain("disputed");
    const allText = JSON.stringify(draft);
    expect(allText).not.toContain("f" + facts.findIndex((f) => f.status === "DISPUTED") + '"');
    assertNoInventedNames(drafterInput, draft);
  });

  it("drafts an interview as Q&A blocks and an upcoming event with WHY / WITH WHOM / WHERE AND WHEN", () => {
    const interview = normalize(ithier.submissions[0], "i0");
    const qa = S.articleDraftSchema.parse(generateLocal(req("article_drafter", { storyType: "INTERVIEW_PROFILE", targetLength: "LONG", targetWords: 600, title: ithier.title, campuses: ["Paris"], factList: [], quoteList: [], submissions: [interview] })));
    expect(qa.blocks.filter((b) => b.type === "qa").map((b) => (b as { question: string }).question)).toEqual(["CAN YOU INTRODUCE YOURSELF?", "WHAT DOES THIS TRAINING INVOLVE?", "WHY?", "HOW DID YOU GET IN?"]);
    const event = S.articleDraftSchema.parse(generateLocal(req("article_drafter", { storyType: "UPCOMING_EVENT", targetLength: "SHORT", targetWords: 200, title: party.title, campuses: ["Paris"], factList: [], quoteList: [], submissions: [normalize(party.submissions[0], "p0")] })));
    const crossheads = event.blocks.filter((b) => b.type === "crosshead").map((b) => (b as { text: string }).text);
    expect(crossheads).toEqual(["WHY?", "WITH WHOM?", "WHERE AND WHEN?"]);
    expect(JSON.stringify(event)).toContain("18 Rue de Paradis");
  });

  it("proposes headlines, a standfirst and a pull quote from the facts only", () => {
    const heads = S.headlinesSchema.parse(generateLocal(req("headline_generator", { storyType: "BUSINESS_DEEP_DIVE", title: "Carrefour – B2 Paris", factList: facts, count: 5, company: "Carrefour", cohort: "B2 Paris" })));
    expect(heads.headlines[0]).toEqual({ text: "Carrefour – B2 Paris", angle: "working title" });
    expect(heads.headlines.length).toBeGreaterThanOrEqual(4);
    for (const h of heads.headlines) expect(h.text.length).toBeLessThanOrEqual(70);
    expect(heads.headlines.map((h) => h.text)).toContain("Our model predicts an estimated increase in sales of 0.4% per shop");
    assertNoInventedNames({ facts, title: "Carrefour – B2 Paris" }, heads);
    const body = draft.blocks.map((b) => ("text" in b && b.text ? b.text : "")).filter(Boolean).join("\n\n");
    const standfirst = S.standfirstSchema.parse(generateLocal(req("standfirst_generator", { headline: heads.headlines[0].text, body })));
    expect(standfirst.standfirst.split(/\s+/).length).toBeLessThanOrEqual(36);
    expect(standfirst.standfirst).toContain("Friday 4 April");
    const pull = S.pullQuoteSchema.parse(generateLocal(req("pull_quote_selector", { quoteList: quotes })));
    expect(pull.quoteId).toBe(quotes.find((q) => q.text.startsWith("Our model predicts"))?.id);
    expect(pull.text!.length).toBeLessThanOrEqual(140);
    expect(S.pullQuoteSchema.parse(generateLocal(req("pull_quote_selector", { quoteList: [] }))).quoteId).toBeNull();
  });

  it("writes captions from the contributor caption or the story title", () => {
    expect(S.captionSchema.parse(generateLocal(req("caption_generator", { storyTitle: "The Jonquille Run", contributorCaption: "", photographer: "Milan Viallet" })))).toEqual({ caption: "The Jonquille Run", credit: "© Milan Viallet" });
    expect(S.captionSchema.parse(generateLocal(req("caption_generator", { storyTitle: "The Jonquille Run", contributorCaption: "Runners at Stade Beaugrenelle", photographer: "" })))).toEqual({ caption: "Runners at Stade Beaugrenelle", credit: null });
  });
});

describe("local provider: editing and planning services", () => {
  it("copy-edits by normalising whitespace and quotes, and can shorten to a target", () => {
    const blocks = [
      { id: "b1", type: "paragraph", text: 'This is "quoted"  text , with spacing. Another sentence here. And a third one that is long enough.' },
      { id: "b2", type: "crosshead", text: "THE CASE" },
    ];
    const out = S.copyEditSchema.parse(generateLocal(req("copy_editor", { instruction: "Copy-edit", targetWords: 0, blockList: blocks })));
    expect((out.blocks[0] as { text: string }).text).toBe("This is “quoted” text, with spacing. Another sentence here. And a third one that is long enough.");
    expect(out.changes[0]).toContain("b1");
    const shorter = S.copyEditSchema.parse(generateLocal(req("copy_editor", { instruction: "Shorten to 8 words", targetWords: 8, blockList: blocks })));
    expect((shorter.blocks[0] as { text: string }).text.split(/\s+/).length).toBeLessThan(blocks[0].text.split(/\s+/).length);
    expect(shorter.changes.some((c) => c.includes("removed the sentence"))).toBe(true);
  });

  it("harmonises tone: capital crossheads and British spelling", () => {
    const out = S.toneSchema.parse(generateLocal(req("tone_harmonizer", { blockList: [{ id: "b1", type: "crosshead", text: "The results" }, { id: "b2", type: "paragraph", text: "We optimized the color of the center to analyze behavior." }] })));
    expect((out.blocks[0] as { text: string }).text).toBe("THE RESULTS");
    expect((out.blocks[1] as { text: string }).text).toBe("We optimised the colour of the centre to analyse behaviour.");
    expect(out.changes).toHaveLength(2);
  });

  it("returns blocks unchanged when asked to translate", () => {
    const blocks = [{ id: "b1", type: "paragraph", text: "Hello" }];
    const out = S.translationSchema.parse(generateLocal(req("translator", { targetLanguage: "fr", blockList: blocks })));
    expect(out.blocks).toEqual(blocks);
    expect(out.notes[0]).toContain("local provider does not translate");
  });

  it("plans sections and templates by story type, picks a cover and spotlights", () => {
    const out = S.sectionPlanSchema.parse(
      generateLocal(
        req("section_planner", {
          sectionList: [{ slug: "spotlight", name: "Spotlight" }, { slug: "bdd", name: "BDD" }, { slug: "campus-life", name: "Campus" }, { slug: "events", name: "Events" }],
          storyList: [
            { id: "s1", title: "Carrefour – B2 Paris", storyType: "BUSINESS_DEEP_DIVE", campuses: ["Paris"], score: 84, words: 700, photos: 3, hasHero: true, targetLength: "FEATURE" },
            { id: "s2", title: "Ithier", storyType: "INTERVIEW_PROFILE", campuses: ["Paris"], score: 86, words: 500, photos: 1, hasHero: true, targetLength: "LONG" },
            { id: "s3", title: "Party", storyType: "UPCOMING_EVENT", campuses: ["Paris"], score: 60, words: 120, photos: 0, hasHero: false, targetLength: "SHORT" },
            { id: "s4", title: "Table football", storyType: "ANECDOTE", campuses: ["Lyon"], score: 55, words: 90, photos: 0, hasHero: false, targetLength: "SHORT" },
          ],
          targetPages: 24,
        }),
      ),
    );
    const byId = Object.fromEntries(out.stories.map((s) => [s.storyId, s]));
    expect(byId.s1).toMatchObject({ sectionSlug: "bdd", template: "BDD_CASE", pages: 2 });
    expect(byId.s2).toMatchObject({ sectionSlug: "spotlight", template: "INTERVIEW", pages: 1 });
    expect(byId.s3).toMatchObject({ sectionSlug: "events", template: "EVENT" });
    expect(byId.s4).toMatchObject({ sectionSlug: "campus-life", template: "SHORTS" });
    expect(out.coverStoryId).toBe("s1");
    expect(out.spotlightStoryIds).toEqual(["s2"]);
  });

  it("selects the cover by score and visual richness among stories with a hero image", () => {
    const out = S.coverSchema.parse(generateLocal(req("cover_selector", { storyList: [
      { id: "a", headline: "A".repeat(80), standfirst: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven", storyType: "BUSINESS_DEEP_DIVE", photos: 3, score: 80, hasHero: true, visualRichness: 85 },
      { id: "b", headline: "Better score, no hero", standfirst: null, storyType: "SCHOOL_NEWS", photos: 0, score: 95, hasHero: false, visualRichness: 20 },
      { id: "c", headline: "Third", standfirst: "x", storyType: "ANECDOTE", photos: 1, score: 50, hasHero: true, visualRichness: 50 },
    ] })));
    expect(out.coverStoryId).toBe("a");
    expect(out.coverHeadline.length).toBeLessThanOrEqual(60);
    expect(out.coverStandfirst.split(/\s+/).length).toBeLessThanOrEqual(26);
    expect(out.teasers.map((t) => t.storyId)).toEqual(["b", "c"]);
    for (const t of out.teasers) expect(t.line.length).toBeLessThanOrEqual(45);
  });

  it("runs the edition QA rules", () => {
    const out = S.editionQaSchema.parse(generateLocal(req("edition_qa", { label: "May 2025", campuses: ["Paris", "Geneva"], articleList: [
      { id: "a1", headline: "A".repeat(75), standfirst: "", section: "bdd", text: "Something happened in Paris.", captionsMissing: 1, imageCount: 2 },
      { id: "a2", headline: "Same headline", standfirst: "Same headline", section: "actus", text: "", captionsMissing: 0, imageCount: 0 },
      { id: "a3", headline: "Same headline", standfirst: "A different standfirst", section: "actus", text: "", captionsMissing: 0, imageCount: 0 },
    ] })));
    const codes = out.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["HEADLINE_TOO_LONG", "STANDFIRST_MISSING", "MISSING_CAPTIONS", "STANDFIRST_REPEATS_HEADLINE", "DUPLICATE_HEADLINE", "CAMPUS_NOT_MENTIONED"]));
    expect(out.issues.find((i) => i.code === "CAMPUS_NOT_MENTIONED")?.message).toContain("Geneva");
    expect(out.issues.find((i) => i.code === "DUPLICATE_HEADLINE")?.severity).toBe("error");
  });

  it("summarises external news keeping the URLs and describes images without naming anyone", () => {
    const news = S.externalNewsSchema.parse(generateLocal(req("external_news_summarizer", { sourceList: [{ url: "https://example.org/a", title: "AI in US schools", text: "The executive order asks agencies to promote AI literacy. It creates a task force. Critics worry about privacy." }], notes: "Relevant for B1 data courses." })));
    expect(news.sourceUrls).toEqual(["https://example.org/a"]);
    expect(news.whyItMatters).toBe("Relevant for B1 data courses.");
    expect(news.paragraphs[0]).toContain("executive order");
    const image = S.imageDescriptionSchema.parse(generateLocal(req("image_describer", { fileName: "carrefour-b2-dashboard-1.jpg", width: 1200, height: 800, caption: "", context: "Carrefour – B2 Paris" })));
    expect(image.kind).toBe("screenshot");
    expect(image.tags).toContain("dashboard");
    const toc = S.tocSchema.parse(generateLocal(req("toc_generator", { articleList: [{ id: "x", section: "bdd", headline: "H".repeat(90), standfirst: null }] })));
    expect(toc.lines[0].text.length).toBeLessThanOrEqual(60);
  });

  it("throws for unknown services", () => {
    expect(() => generateLocal(req("nope", {}))).toThrow(/not implemented/);
  });
});
