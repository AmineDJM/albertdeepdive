import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import {
  articles,
  businessDeepDives,
  campuses,
  editionSections,
  editions,
  events,
  facts,
  informationRequests,
  mediaAssets,
  organisations,
  people,
  quotes,
  stories,
  storyCampuses,
  storyClusterMembers,
  storyClusters,
  storyMedia,
  storyOrganisations,
  storyPeople,
  submissions,
  type JuryMember,
  type TeamMember,
} from "@/server/db/schema";
import { audit, recordDecision } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { defaultSectionForStoryType, PAGE_TEMPLATES, TARGET_LENGTHS } from "@/lib/constants";
import { defaultTemplateForStoryType } from "@/lib/editorial/page-allocation";
import { extractMetrics, extractNameCandidates, nearIdenticalNames, normalizeName, splitNameList, wordCount } from "@/lib/editorial/text";
import { slugify } from "@/lib/utils";
import type { ExtendedFactSheetEntry } from "./clustering";
import { listComments } from "./comments";

const log = createLogger("editorial:stories");

export type StoryRow = typeof stories.$inferSelect;
export type StoryStatus = StoryRow["status"];
export type StoryType = StoryRow["storyType"];
export type TargetLength = (typeof TARGET_LENGTHS)[number]["value"];

const PERSON_ROLES = ["WINNER", "FINALIST", "JURY", "INTERVIEWEE", "AUTHOR", "ORGANISER", "FOUNDER", "MENTIONED"] as const;
const ORG_TYPES = ["COMPANY", "ASSOCIATION", "SCHOOL", "INSTITUTION", "MEDIA", "STARTUP", "OTHER"] as const;
type PersonRole = (typeof PERSON_ROLES)[number];
type OrgType = (typeof ORG_TYPES)[number];

export function targetLengthForWords(words: number): TargetLength {
  if (words < 150) return "SHORT";
  if (words < 400) return "MEDIUM";
  if (words < 800) return "LONG";
  return "FEATURE";
}

export function targetWordsFor(length: string): number {
  const found = TARGET_LENGTHS.find((t) => t.value === length) ?? TARGET_LENGTHS[1];
  return Math.round((found.words[0] + found.words[1]) / 2);
}

async function uniqueStorySlug(editionId: string, title: string): Promise<string> {
  const base = slugify(title) || "story";
  let slug = base;
  let n = 2;
  while (await db.query.stories.findFirst({ where: and(eq(stories.editionId, editionId), eq(stories.slug, slug)), columns: { id: true } })) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
}

export async function upsertPerson(fullName: string, extra: { role?: string | null; campusId?: string | null; programId?: string | null; contributorId?: string | null } = {}) {
  const normalizedName = normalizeName(fullName);
  if (!normalizedName) throw new ValidationError("Empty person name");
  const [row] = await db
    .insert(people)
    .values({ fullName: fullName.trim(), normalizedName, role: extra.role ?? null, campusId: extra.campusId ?? null, programId: extra.programId ?? null, contributorId: extra.contributorId ?? null, mentionsCount: 1 })
    .onConflictDoUpdate({ target: people.normalizedName, set: { mentionsCount: sql`${people.mentionsCount} + 1` } })
    .returning();
  return row;
}

export async function upsertOrganisation(name: string, type: string = "COMPANY") {
  const normalizedName = normalizeName(name);
  if (!normalizedName) throw new ValidationError("Empty organisation name");
  const orgType = (ORG_TYPES as readonly string[]).includes(type) ? (type as OrgType) : "OTHER";
  const [row] = await db
    .insert(organisations)
    .values({ name: name.trim(), normalizedName, type: orgType, mentionsCount: 1 })
    .onConflictDoUpdate({ target: organisations.normalizedName, set: { mentionsCount: sql`${organisations.mentionsCount} + 1` } })
    .returning();
  return row;
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ") || null;
  return null;
}

/**
 * Sources sometimes spell a name differently ("Nathan Sarfaty" vs "Nathan Serfaty"). The
 * disagreement is recorded as a DISPUTED fact for the editor, but the structured Business Deep
 * Dive still has to print one spelling: we use the one most sources agree on, breaking ties with
 * the primary source (and then alphabetically, so the result is deterministic).
 */
export function consensusSpelling(name: string, sourceTexts: string[]): string {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const counts = new Map<string, { count: number; firstSource: number }>();
  sourceTexts.forEach((text, sourceIndex) => {
    const variants = new Set<string>();
    for (const candidate of extractNameCandidates(text)) {
      if (normalizeName(candidate.name) === normalizeName(trimmed) || nearIdenticalNames(candidate.name, trimmed)) variants.add(candidate.name);
    }
    for (const variant of variants) {
      const entry = counts.get(variant) ?? { count: 0, firstSource: sourceIndex };
      entry.count += 1;
      counts.set(variant, entry);
    }
  });
  if (!counts.size) return trimmed;
  const ranked = [...counts.entries()].sort((a, b) => b[1].count - a[1].count || a[1].firstSource - b[1].firstSource || a[0].localeCompare(b[0]));
  return ranked[0][0];
}

function applyConsensus(team: TeamMember[], sourceTexts: string[]): TeamMember[] {
  return team.map((member) => ({ ...member, name: consensusSpelling(member.name, sourceTexts) }));
}

function parseTeam(value: unknown): TeamMember[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? { name: v.trim() } : v && typeof v === "object" && "name" in v ? { name: String((v as { name: unknown }).name), program: asString((v as { program?: unknown }).program) ?? undefined, campus: asString((v as { campus?: unknown }).campus) ?? undefined } : null)).filter((v): v is TeamMember => !!v && !!v.name);
  }
  const s = asString(value);
  return s ? splitNameList(s).map((name) => ({ name })) : [];
}

function parseFinalists(value: unknown): TeamMember[][] {
  if (Array.isArray(value)) return value.map((team) => parseTeam(Array.isArray(team) ? team : typeof team === "string" ? team : [team])).filter((t) => t.length);
  const s = asString(value);
  if (!s) return [];
  return s
    .split(/\s*(?:;|\/|\n|\|)\s*/)
    .map((team) => parseTeam(team))
    .filter((t) => t.length);
}

function parseJury(value: unknown): JuryMember[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === "string" ? parseJuryMember(v) : v && typeof v === "object" && "name" in v ? { name: String((v as { name: unknown }).name), role: asString((v as { role?: unknown }).role) ?? undefined, organisation: asString((v as { organisation?: unknown }).organisation) ?? undefined } : null)).filter((v): v is JuryMember => !!v && !!v.name);
  }
  const s = asString(value);
  if (!s) return [];
  return s
    .split(/\s*(?:,|;|\n|\band\b)\s*/)
    .map(parseJuryMember)
    .filter((m) => m.name);
}

function parseJuryMember(raw: string): JuryMember {
  const m = raw.trim().match(/^(.+?)\s*\((.+)\)\s*$/);
  if (!m) return { name: raw.trim() };
  const [role, organisation] = m[2].split(/\s*,\s*/);
  return { name: m[1].trim(), role: role || undefined, organisation: organisation || undefined };
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => asString(v)).filter((v): v is string => !!v);
  const s = asString(value);
  return s ? s.split(/\s*(?:;|\n|,)\s*/).map((x) => x.trim()).filter(Boolean) : [];
}

function programCodeFrom(text: string | null): string | null {
  return text?.match(/\b(B1|B2|B3|M1|M2|MSc|IBBA|MBA|EXEC)\b/i)?.[1]?.toUpperCase() ?? null;
}

function mediaRole(kind: string, index: number, storyType: string): string {
  switch (kind) {
    case "logo":
      return "logo";
    case "screenshot":
      return "screenshot";
    case "diagram":
    case "chart":
      return "diagram";
    default:
      return index === 0 ? "hero" : storyType === "INTERVIEW_PROFILE" && index === 1 ? "portrait" : "gallery";
  }
}

type MemberSubmission = typeof submissions.$inferSelect & {
  campuses: { campusId: string }[];
  contributor: { id: string; firstName: string; lastName: string; campusId: string | null; programId: string | null } | null;
  mediaAssets: (typeof mediaAssets.$inferSelect)[];
};

async function loadClusterMembers(clusterId: string): Promise<MemberSubmission[]> {
  const members = await db.query.storyClusterMembers.findMany({ where: eq(storyClusterMembers.clusterId, clusterId) });
  if (!members.length) return [];
  const rows = (await db.query.submissions.findMany({
    where: inArray(submissions.id, members.map((m) => m.submissionId)),
    with: { campuses: true, contributor: { columns: { id: true, firstName: true, lastName: true, campusId: true, programId: true } }, mediaAssets: true },
    orderBy: [asc(submissions.createdAt)],
  })) as MemberSubmission[];
  const primaryId = members.find((m) => m.isPrimary)?.submissionId;
  return rows.sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId) || a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Turns a cluster into the editorial unit: story row, campuses, facts (from the fact sheet), quotes,
 * people, organisations, media, BDD / event satellites and an empty article. Idempotent: a cluster
 * that already has a story returns it.
 */
export async function createStoryFromCluster(clusterId: string, opts: { userId?: string | null; status?: StoryStatus } = {}): Promise<StoryRow> {
  const cluster = await db.query.storyClusters.findFirst({ where: eq(storyClusters.id, clusterId), with: { story: true } });
  if (!cluster) throw new NotFoundError("Cluster");
  if (cluster.story) return cluster.story;
  if (cluster.status === "DISMISSED" || cluster.status === "MERGED") throw new ValidationError(`Cannot create a story from a ${cluster.status.toLowerCase()} cluster`);
  const subs = await loadClusterMembers(clusterId);
  if (!subs.length) throw new ValidationError("The cluster has no submissions");
  const primary = subs[0];
  const storyType = cluster.primaryStoryType;
  const sectionRows = await db.query.editionSections.findMany({ where: eq(editionSections.editionId, cluster.editionId) });
  const visible = sectionRows.filter((s) => !s.isHidden);
  const section = visible.find((s) => s.slug === cluster.suggestedSectionSlug) ?? visible.find((s) => s.slug === defaultSectionForStoryType(storyType)) ?? null;
  const totalWords = subs.reduce((n, s) => n + (s.wordCount || wordCount(s.description)), 0);
  let targetLength = targetLengthForWords(totalWords);
  if (storyType === "BUSINESS_DEEP_DIVE" && targetLength === "SHORT") targetLength = "MEDIUM";
  const assets = subs.flatMap((s) => s.mediaAssets.filter((m) => !m.isArchived)).filter((m, i, all) => all.findIndex((x) => x.id === m.id) === i);
  const suggestedTemplate = defaultTemplateForStoryType(storyType, { mediaCount: assets.length, wordCount: totalWords, targetLength });
  const campusIds = [...new Set(subs.flatMap((s) => s.campuses.map((c) => c.campusId)))];
  const slug = await uniqueStorySlug(cluster.editionId, cluster.title);
  const score = cluster.aiScoreTotal !== null ? Math.max(0, Math.min(100, Math.round(cluster.aiScoreTotal))) : null;

  const [story] = await db
    .insert(stories)
    .values({
      editionId: cluster.editionId,
      clusterId,
      sectionId: section?.id ?? null,
      title: cluster.title,
      slug,
      status: opts.status ?? "CANDIDATE",
      storyType,
      summary: cluster.summary,
      eventDate: subs.map((s) => s.eventDate).find((d): d is Date => !!d) ?? null,
      priority: score ?? 50,
      aiScores: cluster.aiScores,
      editorialScore: score,
      aiNotes: cluster.warnings.map((w) => w.message),
      warnings: cluster.warnings,
      missingInformation: cluster.missingInformation,
      suggestedTemplate,
      targetLength,
    })
    .returning();

  if (campusIds.length) await db.insert(storyCampuses).values(campusIds.map((campusId) => ({ storyId: story.id, campusId }))).onConflictDoNothing();

  // Facts from the cluster fact sheet (CONFLICTING → DISPUTED).
  const sheet = cluster.factSheet as ExtendedFactSheetEntry[];
  if (sheet.length) {
    await db.insert(facts).values(
      sheet.map((f: ExtendedFactSheetEntry, i: number) => ({
        editionId: cluster.editionId,
        storyId: story.id,
        clusterId,
        statement: f.statement,
        category: f.category ?? "other",
        sourceSubmissionId: f.sourceSubmissionIds[0] ?? null,
        sourceExcerpt: f.excerpt ?? null,
        confidence: f.confidence,
        status: f.confidence === "CONFLICTING" ? ("DISPUTED" as const) : ("ACTIVE" as const),
        conflictGroup: f.confidence === "CONFLICTING" ? `${story.id.slice(0, 8)}-conflict-${i + 1}` : null,
        createdByAi: true,
      })),
    );
  }
  await db.update(quotes).set({ storyId: story.id }).where(and(eq(quotes.clusterId, clusterId), isNull(quotes.storyId)));

  // People and organisations from the extracted entities.
  const companyName = asString(subs.map((s) => s.extra?.company).find(Boolean));
  const seenPeople = new Set<string>();
  for (const sub of subs) {
    for (const person of sub.aiEntities?.people ?? []) {
      const key = normalizeName(person.name);
      if (!key || seenPeople.has(`${key}:${person.role ?? ""}`)) continue;
      seenPeople.add(`${key}:${person.role ?? ""}`);
      const role: PersonRole = (PERSON_ROLES as readonly string[]).includes(person.role ?? "") ? (person.role as PersonRole) : storyType === "INTERVIEW_PROFILE" && seenPeople.size === 1 ? "INTERVIEWEE" : "MENTIONED";
      const row = await upsertPerson(person.name, { role: role === "JURY" ? "Jury member" : null, campusId: campusIds.length === 1 ? campusIds[0] : null });
      await db.insert(storyPeople).values({ storyId: story.id, personId: row.id, role, sourceSubmissionId: sub.id }).onConflictDoNothing();
    }
  }
  const seenOrgs = new Set<string>();
  for (const sub of subs) {
    for (const org of sub.aiEntities?.organisations ?? []) {
      const key = normalizeName(org.name);
      if (!key || seenOrgs.has(key)) continue;
      seenOrgs.add(key);
      const row = await upsertOrganisation(org.name, org.type ?? "COMPANY");
      const role = companyName && normalizeName(companyName) === key ? "PARTNER" : storyType === "ASSOCIATION" && row.type === "ASSOCIATION" ? "SUBJECT" : "MENTIONED";
      await db.insert(storyOrganisations).values({ storyId: story.id, organisationId: row.id, role }).onConflictDoNothing();
    }
  }

  // Media: first photo becomes the hero.
  let photoIndex = 0;
  if (assets.length) {
    await db.insert(storyMedia).values(
      assets.map((asset, i) => {
        const role = mediaRole(asset.kind, asset.kind === "photo" ? photoIndex++ : -1, storyType);
        return { storyId: story.id, mediaAssetId: asset.id, role, sortOrder: i, addedByAi: true };
      }),
    ).onConflictDoNothing();
  }

  // Satellites.
  if (storyType === "BUSINESS_DEEP_DIVE") {
    const extra = subs.reduce<Record<string, unknown>>((acc, s) => ({ ...s.extra, ...acc }), {});
    // Primary source first: it breaks ties when sources spell a name differently.
    const sourceTexts = subs.map((s) => [s.normalizedText ?? s.description, s.peopleInvolved ?? "", JSON.stringify(s.extra ?? {})].join("\n"));
    const company = asString(extra.company) ?? subs.flatMap((s) => s.aiEntities?.organisations ?? []).find((o) => o.type === "COMPANY")?.name ?? cluster.title.split(/\s[–-]\s/)[0];
    const cohort = asString(extra.cohort);
    const orgRow = company ? await db.query.organisations.findFirst({ where: eq(organisations.normalizedName, normalizeName(company)) }) : null;
    const campusRows = campusIds.length ? await db.query.campuses.findMany({ where: inArray(campuses.id, campusIds) }) : [];
    const cohortCampus = cohort ? campusRows.find((c) => cohort.toLowerCase().includes(c.name.toLowerCase())) : undefined;
    const technologies = parseStringList(extra.technologies);
    const results = asString(extra.measurableResults);
    const metrics = results ? extractMetrics(results).map((m) => ({ label: m.label, value: m.value })) : [];
    await db.insert(businessDeepDives).values({
      storyId: story.id,
      editionId: cluster.editionId,
      organisationId: orgRow?.id ?? null,
      companyName: company ?? cluster.title,
      programCode: programCodeFrom(cohort),
      campusId: cohortCampus?.id ?? campusRows[0]?.id ?? null,
      cohortLabel: cohort,
      dateText: asString(extra.projectDates) ?? primary.eventDateText ?? null,
      startDate: null,
      endDate: null,
      theCase: null,
      theChallenge: asString(extra.businessProblem),
      theData: asString(extra.dataset),
      theApproach: asString(extra.methodology),
      theMethods: technologies.length ? technologies.join(", ") : asString(extra.methodology),
      theSolution: asString(extra.finalRecommendation),
      theResults: results,
      keyTakeaways: parseStringList(extra.lessonsLearned),
      winningTeam: applyConsensus(parseTeam(extra.winningTeam), sourceTexts),
      finalists: parseFinalists(extra.finalists).map((team) => applyConsensus(team, sourceTexts)),
      jury: applyConsensus(parseJury(extra.jury) as TeamMember[], sourceTexts) as ReturnType<typeof parseJury>,
      technologies,
      metrics,
      logoAssetId: assets.find((a) => a.kind === "logo")?.id ?? orgRow?.logoAssetId ?? null,
      teamPhotoAssetId: assets.find((a) => a.kind === "photo")?.id ?? null,
      dashboardAssetId: assets.find((a) => a.kind === "screenshot")?.id ?? null,
      diagramAssetId: assets.find((a) => a.kind === "diagram" || a.kind === "chart")?.id ?? null,
      quoteId: (await db.query.quotes.findFirst({ where: and(eq(quotes.storyId, story.id), eq(quotes.isPullQuoteCandidate, true)), columns: { id: true } }))?.id ?? null,
    });
  }
  if (storyType === "UPCOMING_EVENT" || storyType === "EVENT_RECAP") {
    const extra = subs.reduce<Record<string, unknown>>((acc, s) => ({ ...s.extra, ...acc }), {});
    const urls = [...new Set(subs.flatMap((s) => s.urls))];
    const place = asString(extra.place) ?? asString(extra.location) ?? asString(extra.venue) ?? subs.flatMap((s) => s.aiEntities?.places ?? [])[0] ?? null;
    await db.insert(events).values({
      editionId: cluster.editionId,
      storyId: story.id,
      title: cluster.title,
      description: cluster.summary,
      startsAt: story.eventDate,
      dateText: primary.eventDateText ?? subs.map((s) => s.eventDateText).find(Boolean) ?? asString(extra.date) ?? null,
      location: place,
      campusId: campusIds.length === 1 ? campusIds[0] : null,
      isUpcoming: storyType === "UPCOMING_EVENT",
      signupUrl: asString(extra.signupUrl) ?? urls.find((u) => /sign|form|register|lu\.ma|eventbrite|weezevent|helloasso/i.test(u)) ?? (storyType === "UPCOMING_EVENT" ? (urls[0] ?? null) : null),
      organiser: asString(extra.organiser) ?? subs.flatMap((s) => s.aiEntities?.organisations ?? []).find((o) => o.type === "ASSOCIATION")?.name ?? null,
      sourceSubmissionId: primary.id,
    });
  }

  // Empty article shell so the story screen always has something to open.
  const campusSlugs = campusIds.length ? (await db.query.campuses.findMany({ where: inArray(campuses.id, campusIds), columns: { slug: true } })).map((c) => c.slug) : [];
  await db
    .insert(articles)
    .values({
      storyId: story.id,
      editionId: cluster.editionId,
      kicker: section?.kicker ?? null,
      headline: "",
      byline: primary.contributor ? `${primary.contributor.firstName} ${primary.contributor.lastName}` : primary.contactName,
      authorContributorId: primary.contributor?.id ?? null,
      body: [],
      tags: [section?.slug, ...campusSlugs].filter((t): t is string => !!t),
      status: "EMPTY",
    })
    .onConflictDoNothing();

  await audit({ action: "story.create", userId: opts.userId ?? null, actorType: opts.userId ? "USER" : "AI", entityType: "STORY", entityId: story.id, editionId: cluster.editionId, metadata: { clusterId, storyType, submissions: subs.map((s) => s.id), facts: sheet.length, media: assets.length } });
  log.info("story created", { storyId: story.id, clusterId, storyType });
  return story;
}

/** Creates a story for every confirmed or proposed cluster of the edition that has none yet. */
export async function createStoriesForEdition(editionId: string, opts: { userId?: string | null } = {}): Promise<{ created: string[]; existing: number }> {
  const clusters = await db.query.storyClusters.findMany({ where: and(eq(storyClusters.editionId, editionId), inArray(storyClusters.status, ["CONFIRMED", "PROPOSED"])), with: { story: { columns: { id: true } } }, orderBy: [asc(storyClusters.createdAt)] });
  const created: string[] = [];
  let existing = 0;
  for (const c of clusters) {
    if (c.story) {
      existing += 1;
      continue;
    }
    if (c.submissionCount === 0) continue;
    const story = await createStoryFromCluster(c.id, { userId: opts.userId ?? null });
    created.push(story.id);
  }
  return { created, existing };
}

async function loadStory(storyId: string): Promise<StoryRow> {
  const story = await db.query.stories.findFirst({ where: eq(stories.id, storyId) });
  if (!story) throw new NotFoundError("Story");
  return story;
}

export const storyPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  summary: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  editorialNotes: z.string().nullable().optional(),
  editorialScore: z.number().int().min(0).max(100).nullable().optional(),
  targetLength: z.enum(["SHORT", "MEDIUM", "LONG", "FEATURE"]).optional(),
  suggestedTemplate: z.string().nullable().optional(),
  isSpotlight: z.boolean().optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  storyType: z.string().optional(),
  eventDate: z.coerce.date().nullable().optional(),
});
export type StoryPatch = z.infer<typeof storyPatchSchema>;

export async function updateStory(storyId: string, patch: StoryPatch, userId: string) {
  const parsed = storyPatchSchema.safeParse(patch);
  if (!parsed.success) throw new ValidationError("Invalid story update", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])));
  const story = await loadStory(storyId);
  const data = parsed.data;
  if (data.suggestedTemplate && !PAGE_TEMPLATES.some((t) => t.code === data.suggestedTemplate)) throw new ValidationError(`Unknown template ${data.suggestedTemplate}`);
  const [row] = await db
    .update(stories)
    .set({ ...data, storyType: (data.storyType as StoryType | undefined) ?? undefined })
    .where(eq(stories.id, storyId))
    .returning();
  await audit({ action: "story.update", userId, entityType: "STORY", entityId: storyId, editionId: story.editionId, metadata: { fields: Object.keys(data) } });
  return row;
}

export const blankStorySchema = z.object({
  title: z.string().trim().min(1).max(200),
  storyType: z.string().optional(),
  sectionId: z.string().uuid().nullable().optional(),
});
export type BlankStoryInput = z.infer<typeof blankStorySchema>;

/**
 * Creates a hand-authored story with an empty, editable article shell — the "New article" path that
 * does not come from the AI/cluster pipeline. The story is SELECTED so it is placeable straight away,
 * and the article opens in the normal workbench for the editor to write.
 */
export async function createBlankStory(editionId: string, rawInput: BlankStoryInput, userId: string): Promise<{ story: StoryRow; articleId: string }> {
  const input = blankStorySchema.parse(rawInput);
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId), columns: { id: true } });
  if (!edition) throw new NotFoundError("Edition");
  const storyType = ((input.storyType as StoryType | undefined) ?? "OTHER") as StoryType;
  let section = null as (typeof editionSections.$inferSelect) | null;
  if (input.sectionId) {
    section = (await db.query.editionSections.findFirst({ where: eq(editionSections.id, input.sectionId) })) ?? null;
    if (!section || section.editionId !== editionId) throw new ValidationError("The section does not belong to this edition");
  } else {
    const visible = (await db.query.editionSections.findMany({ where: eq(editionSections.editionId, editionId) })).filter((s) => !s.isHidden);
    section = visible.find((s) => s.slug === defaultSectionForStoryType(storyType)) ?? null;
  }
  const slug = await uniqueStorySlug(editionId, input.title);
  const [story] = await db
    .insert(stories)
    .values({
      editionId,
      sectionId: section?.id ?? null,
      title: input.title,
      slug,
      status: "SELECTED",
      storyType,
      priority: 50,
      suggestedTemplate: defaultTemplateForStoryType(storyType, { mediaCount: 0, wordCount: 0, targetLength: "MEDIUM" }),
      targetLength: "MEDIUM",
    })
    .returning();
  const [article] = await db
    .insert(articles)
    .values({ storyId: story.id, editionId, kicker: section?.kicker ?? null, headline: input.title, body: [], tags: section?.slug ? [section.slug] : [], status: "IN_EDITING" })
    .returning({ id: articles.id });
  await audit({ action: "story.create", userId, entityType: "STORY", entityId: story.id, editionId, metadata: { manual: true, storyType } });
  log.info("blank story created", { storyId: story.id, articleId: article.id, storyType });
  return { story, articleId: article.id };
}

async function transitionStory(storyId: string, status: StoryStatus, userId: string, decision: string, reason?: string | null) {
  const story = await loadStory(storyId);
  const [row] = await db.update(stories).set({ status }).where(eq(stories.id, storyId)).returning();
  await recordDecision({ editionId: story.editionId, entityType: "STORY", entityId: storyId, decision, reason: reason ?? null, previousValue: { status: story.status }, newValue: { status }, userId });
  return row;
}

export const selectStory = (storyId: string, userId: string) => transitionStory(storyId, "SELECTED", userId, "STORY_SELECT");
export const rejectStory = (storyId: string, userId: string, reason?: string | null) => transitionStory(storyId, "REJECTED", userId, "STORY_REJECT", reason);
export const dropStory = (storyId: string, userId: string, reason?: string | null) => transitionStory(storyId, "DROPPED", userId, "STORY_DROP", reason);

export async function assignSection(storyId: string, sectionId: string | null, userId: string) {
  const story = await loadStory(storyId);
  if (sectionId) {
    const section = await db.query.editionSections.findFirst({ where: eq(editionSections.id, sectionId) });
    if (!section || section.editionId !== story.editionId) throw new ValidationError("The section does not belong to this edition");
  }
  const [row] = await db.update(stories).set({ sectionId }).where(eq(stories.id, storyId)).returning();
  await recordDecision({ editionId: story.editionId, entityType: "STORY", entityId: storyId, decision: "STORY_ASSIGN_SECTION", previousValue: { sectionId: story.sectionId }, newValue: { sectionId }, userId });
  return row;
}

export async function setCoverStory(editionId: string, storyId: string, userId: string) {
  const story = await loadStory(storyId);
  if (story.editionId !== editionId) throw new ValidationError("The story belongs to another edition");
  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId), columns: { id: true, coverStoryId: true, coverMediaAssetId: true } });
  if (!edition) throw new NotFoundError("Edition");
  const hero = await db.query.storyMedia.findFirst({ where: and(eq(storyMedia.storyId, storyId), eq(storyMedia.role, "hero")) });
  await db.transaction(async (tx) => {
    await tx.update(stories).set({ isCover: false }).where(and(eq(stories.editionId, editionId), eq(stories.isCover, true)));
    await tx.update(stories).set({ isCover: true }).where(eq(stories.id, storyId));
    await tx.update(editions).set({ coverStoryId: storyId, coverMediaAssetId: edition.coverMediaAssetId ?? hero?.mediaAssetId ?? null }).where(eq(editions.id, editionId));
  });
  await recordDecision({ editionId, entityType: "EDITION", entityId: editionId, decision: "EDITION_SET_COVER", previousValue: { coverStoryId: edition.coverStoryId }, newValue: { coverStoryId: storyId }, userId });
  return loadStory(storyId);
}

export async function attachMedia(storyId: string, mediaAssetId: string, options: { role?: string; userId?: string | null } = {}) {
  const story = await loadStory(storyId);
  const asset = await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.id, mediaAssetId) });
  if (!asset) throw new NotFoundError("Media asset");
  if (asset.editionId && asset.editionId !== story.editionId) throw new ValidationError("The asset belongs to another edition");
  const [max] = await db.select({ n: sql<number>`coalesce(max(${storyMedia.sortOrder}), -1)::int` }).from(storyMedia).where(eq(storyMedia.storyId, storyId));
  const role = options.role ?? mediaRole(asset.kind, 1, story.storyType);
  const [row] = await db
    .insert(storyMedia)
    .values({ storyId, mediaAssetId, role, sortOrder: Number(max?.n ?? -1) + 1, addedByAi: !options.userId })
    .onConflictDoUpdate({ target: [storyMedia.storyId, storyMedia.mediaAssetId], set: { role } })
    .returning();
  await audit({ action: "story.media.attach", userId: options.userId ?? null, entityType: "STORY", entityId: storyId, editionId: story.editionId, metadata: { mediaAssetId, role } });
  return row;
}

export async function detachMedia(storyId: string, mediaAssetId: string, userId?: string | null) {
  const story = await loadStory(storyId);
  const link = await db.query.storyMedia.findFirst({ where: and(eq(storyMedia.storyId, storyId), eq(storyMedia.mediaAssetId, mediaAssetId)) });
  if (!link) throw new NotFoundError("Story media");
  if (link.isLocked) throw new ValidationError("This image is locked on the page plan");
  await db.delete(storyMedia).where(and(eq(storyMedia.storyId, storyId), eq(storyMedia.mediaAssetId, mediaAssetId)));
  await audit({ action: "story.media.detach", userId: userId ?? null, entityType: "STORY", entityId: storyId, editionId: story.editionId, metadata: { mediaAssetId } });
  return { ok: true };
}

export async function reorderMedia(storyId: string, orderedAssetIds: string[], userId?: string | null) {
  const story = await loadStory(storyId);
  const links = await db.query.storyMedia.findMany({ where: eq(storyMedia.storyId, storyId) });
  const known = new Set(links.map((l) => l.mediaAssetId));
  const ordered = orderedAssetIds.filter((id) => known.has(id));
  const rest = links.map((l) => l.mediaAssetId).filter((id) => !ordered.includes(id));
  await db.transaction(async (tx) => {
    for (const [i, id] of [...ordered, ...rest].entries()) {
      await tx.update(storyMedia).set({ sortOrder: i, role: i === 0 && links.find((l) => l.mediaAssetId === id)?.role === "gallery" ? "hero" : links.find((l) => l.mediaAssetId === id)?.role === "hero" && i > 0 ? "gallery" : undefined }).where(and(eq(storyMedia.storyId, storyId), eq(storyMedia.mediaAssetId, id)));
    }
  });
  await audit({ action: "story.media.reorder", userId: userId ?? null, entityType: "STORY", entityId: storyId, editionId: story.editionId, metadata: { order: [...ordered, ...rest] } });
  return db.query.storyMedia.findMany({ where: eq(storyMedia.storyId, storyId), orderBy: [asc(storyMedia.sortOrder)] });
}

/** Everything the story screen needs in one call. */
export async function storyOverview(storyId: string) {
  const story = await db.query.stories.findFirst({
    where: eq(stories.id, storyId),
    with: {
      section: true,
      cluster: { with: { members: true } },
      article: true,
      campuses: { with: { campus: true } },
      media: { with: { asset: true }, orderBy: [asc(storyMedia.sortOrder)] },
      facts: { orderBy: [asc(facts.createdAt)] },
      quotes: { orderBy: [desc(quotes.isPullQuoteCandidate), asc(quotes.createdAt)] },
      people: { with: { person: true } },
      organisations: { with: { organisation: true } },
      events: true,
      bdd: true,
      assignedTo: { columns: { id: true, name: true, avatarUrl: true } },
      informationRequests: { orderBy: [desc(informationRequests.createdAt)] },
    },
  });
  if (!story) throw new NotFoundError("Story");
  const memberIds = story.cluster?.members.map((m) => m.submissionId) ?? [];
  const subs = memberIds.length
    ? await db.query.submissions.findMany({ where: inArray(submissions.id, memberIds), with: { contributor: { columns: { id: true, firstName: true, lastName: true, email: true, type: true } }, campuses: { with: { campus: { columns: { id: true, name: true, slug: true } } } }, mediaAssets: { columns: { id: true, fileName: true, kind: true, caption: true, rightsStatus: true } } }, orderBy: [asc(submissions.createdAt)] })
    : [];
  const primaryId = story.cluster?.members.find((m) => m.isPrimary)?.submissionId;
  subs.sort((a, b) => Number(b.id === primaryId) - Number(a.id === primaryId) || a.createdAt.getTime() - b.createdAt.getTime());
  const comments = await listComments("STORY", storyId);
  const revisionCount = story.article ? Number((await db.select({ n: sql<number>`count(*)::int` }).from(sql`article_revisions`).where(sql`article_id = ${story.article.id}`))[0]?.n ?? 0) : 0;
  const { cluster, article, ...rest } = story;
  return {
    story: rest,
    cluster,
    submissions: subs,
    facts: story.facts,
    quotes: story.quotes,
    people: story.people,
    organisations: story.organisations,
    media: story.media,
    article: article ? { ...article, revisionCount } : null,
    bdd: story.bdd,
    events: story.events,
    informationRequests: story.informationRequests,
    comments,
    disputedFacts: story.facts.filter((f) => f.status === "DISPUTED").length,
  };
}

/** Counts for the edition dashboards: stories by status, section, campus and type, plus article states. */
export async function editionStorySummary(editionId: string) {
  const rows = await db.query.stories.findMany({ where: eq(stories.editionId, editionId), with: { section: { columns: { id: true, slug: true, name: true } }, campuses: { with: { campus: { columns: { id: true, name: true, slug: true } } } }, article: { columns: { status: true, wordCount: true } } } });
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const bySectionMap = new Map<string, { sectionId: string | null; slug: string; name: string; count: number }>();
  const byCampusMap = new Map<string, { campusId: string; name: string; slug: string; count: number }>();
  const articlesByStatus: Record<string, number> = {};
  let words = 0;
  for (const s of rows) {
    byStatus[s.status] = (byStatus[s.status] ?? 0) + 1;
    byType[s.storyType] = (byType[s.storyType] ?? 0) + 1;
    const key = s.section?.id ?? "none";
    const sec = bySectionMap.get(key) ?? { sectionId: s.section?.id ?? null, slug: s.section?.slug ?? "unassigned", name: s.section?.name ?? "Unassigned", count: 0 };
    sec.count += 1;
    bySectionMap.set(key, sec);
    if (!s.campuses.length) {
      const sw = byCampusMap.get("school") ?? { campusId: "school", name: "School-wide", slug: "school", count: 0 };
      sw.count += 1;
      byCampusMap.set("school", sw);
    }
    for (const c of s.campuses) {
      const entry = byCampusMap.get(c.campus.id) ?? { campusId: c.campus.id, name: c.campus.name, slug: c.campus.slug, count: 0 };
      entry.count += 1;
      byCampusMap.set(c.campus.id, entry);
    }
    if (s.article) {
      articlesByStatus[s.article.status] = (articlesByStatus[s.article.status] ?? 0) + 1;
      words += s.article.wordCount;
    }
  }
  const [disputed] = await db.select({ n: sql<number>`count(*)::int` }).from(facts).where(and(eq(facts.editionId, editionId), eq(facts.status, "DISPUTED")));
  const [missing] = await db.select({ n: sql<number>`count(*)::int` }).from(stories).where(and(eq(stories.editionId, editionId), sql`jsonb_array_length(${stories.missingInformation}) > 0`));
  return {
    editionId,
    total: rows.length,
    byStatus,
    byType,
    bySection: [...bySectionMap.values()],
    byCampus: [...byCampusMap.values()],
    articlesByStatus,
    totalWords: words,
    disputedFacts: Number(disputed?.n ?? 0),
    storiesWithMissingInformation: Number(missing?.n ?? 0),
    cover: rows.find((s) => s.isCover)?.id ?? null,
  };
}

