/**
 * Archive — the institutional memory: every story of every edition, searchable by text, people,
 * organisations, campuses, sections and Business Deep Dive companies.
 *
 * Search strategy
 * ---------------
 * When a query is present, `searchStoriesFullText` ranks stories with PostgreSQL full-text search
 * (`to_tsvector('english', …)` over headline + standfirst + title + summary + article body text,
 * matched with `plainto_tsquery`). Stories mentioning a matching person, organisation or BDD
 * company are added through ILIKE, and an ILIKE fallback on the text fields covers queries the
 * stemmer cannot handle (very short tokens, stop words, accents). No index is required at this
 * scale; a GIN index on the expression can be added in a migration when the archive grows.
 *
 * Embeddings (later): add a `story_embeddings` table (story_id uuid PK, model text, embedding
 * vector(1536), updated_at) populated by an `embedding.index` job whenever an article is approved,
 * and use `pgvector` cosine distance as a third candidate source merged with the FTS ranks here
 * (reciprocal-rank fusion). The result shape of this module would not change.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { mediaUrls } from "@/server/media/urls";
import { STORY_TYPES } from "@/lib/constants";
import { workspaceMasthead } from "@/server/publication/naming";

export const ARCHIVE_STORY_STATUSES = ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED", "PUBLISHED"] as const;

export type ArchiveFilters = {
  q?: string;
  editionId?: string;
  campusId?: string;
  storyType?: string;
  section?: string;
  organisation?: string;
  person?: string;
  association?: string;
  /** YYYY-MM (edition month) */
  from?: string;
  to?: string;
};

export type ArchiveStory = {
  id: string;
  title: string;
  headline: string;
  standfirst: string | null;
  storyType: string;
  status: string;
  isCover: boolean;
  editionId: string;
  editionLabel: string;
  editionStatus: string;
  issueLabel: string;
  section: { slug: string; name: string; colour: string | null } | null;
  bdd: { companyName: string; cohortLabel: string | null } | null;
  wordCount: number;
  campuses: { name: string; colour: string | null }[];
  people: { id: string; name: string; role: string }[];
  organisations: { id: string; name: string; type: string; role: string }[];
  rank: number;
};

export type ArchiveEditionGroup = {
  editionId: string;
  label: string;
  issueLabel: string;
  status: string;
  coverUrl: string | null;
  coverHeadline: string | null;
  stories: ArchiveStory[];
};

/** Ranked story ids for a free-text query (full-text first, ILIKE as a safety net). */
export async function searchStoriesFullText(query: string, limit = 300): Promise<Map<string, number>> {
  const q = query.trim();
  const ranks = new Map<string, number>();
  if (q.length < 2) return ranks;
  const fts = await db.execute<{ id: string; rank: number }>(sql`
    with docs as (
      select st.id,
        setweight(to_tsvector('english', coalesce(a.headline, '') || ' ' || st.title), 'A') ||
        setweight(to_tsvector('english', coalesce(a.standfirst, '') || ' ' || coalesce(st.summary, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(a.body::text, '')), 'C') as doc
      from ${s.stories} st
      left join ${s.articles} a on a.story_id = st.id
    )
    select id, ts_rank(doc, plainto_tsquery('english', ${q})) as rank
    from docs
    where doc @@ plainto_tsquery('english', ${q})
    order by rank desc
    limit ${limit}
  `);
  for (const row of fts) ranks.set(row.id, Number(row.rank) + 1);
  const like = `%${q}%`;
  const entityMatches = await db
    .select({ id: s.stories.id })
    .from(s.stories)
    .leftJoin(s.articles, eq(s.articles.storyId, s.stories.id))
    .where(
      or(
        ilike(s.stories.title, like),
        ilike(s.articles.headline, like),
        ilike(s.articles.standfirst, like),
        sql`${s.articles.body}::text ilike ${like}`,
        sql`exists (select 1 from ${s.storyPeople} sp join ${s.people} p on p.id = sp.person_id where sp.story_id = ${s.stories.id} and p.full_name ilike ${like})`,
        sql`exists (select 1 from ${s.storyOrganisations} so join ${s.organisations} o on o.id = so.organisation_id where so.story_id = ${s.stories.id} and o.name ilike ${like})`,
        sql`exists (select 1 from ${s.businessDeepDives} b where b.story_id = ${s.stories.id} and (b.company_name ilike ${like} or b.cohort_label ilike ${like} or b.the_methods ilike ${like}))`,
      ),
    )
    .limit(limit);
  for (const row of entityMatches) if (!ranks.has(row.id)) ranks.set(row.id, 0.5);
  return ranks;
}

export async function searchArchive(filters: ArchiveFilters = {}, limit = 200): Promise<{ groups: ArchiveEditionGroup[]; total: number }> {
  const where: SQL[] = [inArray(s.stories.status, [...ARCHIVE_STORY_STATUSES])];
  let ranks: Map<string, number> | null = null;
  if (filters.q?.trim()) {
    ranks = await searchStoriesFullText(filters.q);
    if (!ranks.size) return { groups: [], total: 0 };
    where.push(inArray(s.stories.id, [...ranks.keys()]));
  }
  if (filters.editionId) where.push(eq(s.stories.editionId, filters.editionId));
  if (filters.storyType) where.push(sql`${s.stories.storyType}::text = ${filters.storyType}`);
  if (filters.section) where.push(eq(s.editionSections.slug, filters.section));
  if (filters.campusId) where.push(sql`exists (select 1 from ${s.storyCampuses} sc where sc.story_id = ${s.stories.id} and sc.campus_id = ${filters.campusId})`);
  if (filters.person?.trim()) {
    const like = `%${filters.person.trim()}%`;
    where.push(sql`exists (select 1 from ${s.storyPeople} sp join ${s.people} p on p.id = sp.person_id where sp.story_id = ${s.stories.id} and p.full_name ilike ${like})`);
  }
  if (filters.organisation?.trim()) {
    const like = `%${filters.organisation.trim()}%`;
    where.push(
      or(
        sql`exists (select 1 from ${s.storyOrganisations} so join ${s.organisations} o on o.id = so.organisation_id where so.story_id = ${s.stories.id} and o.name ilike ${like})`,
        sql`exists (select 1 from ${s.businessDeepDives} b where b.story_id = ${s.stories.id} and b.company_name ilike ${like})`,
      )!,
    );
  }
  if (filters.association?.trim()) {
    const like = `%${filters.association.trim()}%`;
    where.push(sql`exists (select 1 from ${s.storyOrganisations} so join ${s.organisations} o on o.id = so.organisation_id where so.story_id = ${s.stories.id} and o.type = 'ASSOCIATION' and o.name ilike ${like})`);
  }
  const monthKey = sql`${s.editions.year} * 100 + ${s.editions.month}`;
  if (filters.from && /^\d{4}-\d{2}$/.test(filters.from)) where.push(sql`${monthKey} >= ${Number(filters.from.replace("-", ""))}`);
  if (filters.to && /^\d{4}-\d{2}$/.test(filters.to)) where.push(sql`${monthKey} <= ${Number(filters.to.replace("-", ""))}`);

  const rows = await db
    .select({
      id: s.stories.id,
      title: s.stories.title,
      storyType: s.stories.storyType,
      status: s.stories.status,
      isCover: s.stories.isCover,
      priority: s.stories.priority,
      editionId: s.stories.editionId,
      editionLabel: s.editions.label,
      editionStatus: s.editions.status,
      issueNumber: s.editions.issueNumber,
      isSpecialIssue: s.editions.isSpecialIssue,
      coverMediaAssetId: s.editions.coverMediaAssetId,
      coverHeadline: s.editions.coverHeadline,
      year: s.editions.year,
      month: s.editions.month,
      headline: s.articles.headline,
      standfirst: s.articles.standfirst,
      wordCount: s.articles.wordCount,
      sectionSlug: s.editionSections.slug,
      sectionName: s.editionSections.name,
      sectionColour: s.editionSections.colour,
      sectionOrder: s.editionSections.sortOrder,
      bddCompany: s.businessDeepDives.companyName,
      bddCohort: s.businessDeepDives.cohortLabel,
    })
    .from(s.stories)
    .innerJoin(s.editions, eq(s.editions.id, s.stories.editionId))
    .leftJoin(s.articles, eq(s.articles.storyId, s.stories.id))
    .leftJoin(s.editionSections, eq(s.editionSections.id, s.stories.sectionId))
    .leftJoin(s.businessDeepDives, eq(s.businessDeepDives.storyId, s.stories.id))
    .where(and(...where))
    .orderBy(desc(s.editions.year), desc(s.editions.month), asc(s.editionSections.sortOrder), desc(s.stories.isCover), desc(s.stories.priority))
    .limit(limit);
  if (!rows.length) return { groups: [], total: 0 };

  const ids = rows.map((r) => r.id);
  const [campusRows, peopleRows, orgRows] = await Promise.all([
    db.select({ storyId: s.storyCampuses.storyId, name: s.campuses.name, colour: s.campuses.colour, sortOrder: s.campuses.sortOrder }).from(s.storyCampuses).innerJoin(s.campuses, eq(s.campuses.id, s.storyCampuses.campusId)).where(inArray(s.storyCampuses.storyId, ids)),
    db.select({ storyId: s.storyPeople.storyId, id: s.people.id, name: s.people.fullName, role: s.storyPeople.role }).from(s.storyPeople).innerJoin(s.people, eq(s.people.id, s.storyPeople.personId)).where(inArray(s.storyPeople.storyId, ids)),
    db.select({ storyId: s.storyOrganisations.storyId, id: s.organisations.id, name: s.organisations.name, type: s.organisations.type, role: s.storyOrganisations.role }).from(s.storyOrganisations).innerJoin(s.organisations, eq(s.organisations.id, s.storyOrganisations.organisationId)).where(inArray(s.storyOrganisations.storyId, ids)),
  ]);
  const group = <T extends { storyId: string }>(list: T[]) => {
    const map = new Map<string, T[]>();
    for (const item of list) map.set(item.storyId, [...(map.get(item.storyId) ?? []), item]);
    return map;
  };
  const campusMap = group(campusRows);
  const peopleMap = group(peopleRows);
  const orgMap = group(orgRows);
  const coverIds = [...new Set(rows.map((r) => r.coverMediaAssetId).filter((v): v is string => !!v))];
  const covers = coverIds.length ? await mediaUrls(coverIds, "THUMBNAIL") : {};

  const stories: ArchiveStory[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    headline: r.headline?.trim() || r.title,
    standfirst: r.standfirst,
    storyType: r.storyType,
    status: r.status,
    isCover: r.isCover,
    editionId: r.editionId,
    editionLabel: r.editionLabel,
    editionStatus: r.editionStatus,
    issueLabel: `${r.isSpecialIssue ? "Special issue" : "Issue"} N°${r.issueNumber}`,
    section: r.sectionSlug ? { slug: r.sectionSlug, name: r.sectionName ?? r.sectionSlug, colour: r.sectionColour } : null,
    bdd: r.bddCompany ? { companyName: r.bddCompany, cohortLabel: r.bddCohort } : null,
    wordCount: r.wordCount ?? 0,
    campuses: (campusMap.get(r.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map((c) => ({ name: c.name, colour: c.colour })),
    people: (peopleMap.get(r.id) ?? []).map((p) => ({ id: p.id, name: p.name, role: p.role })),
    organisations: (orgMap.get(r.id) ?? []).map((o) => ({ id: o.id, name: o.name, type: o.type, role: o.role })),
    rank: ranks?.get(r.id) ?? 0,
  }));
  if (ranks) stories.sort((a, b) => b.rank - a.rank);

  const groups: ArchiveEditionGroup[] = [];
  const byEdition = new Map<string, ArchiveEditionGroup>();
  for (const row of rows) {
    if (byEdition.has(row.editionId)) continue;
    const g: ArchiveEditionGroup = { editionId: row.editionId, label: row.editionLabel, issueLabel: `${row.isSpecialIssue ? "Special issue" : "Issue"} N°${row.issueNumber}`, status: row.editionStatus, coverUrl: row.coverMediaAssetId ? (covers[row.coverMediaAssetId] ?? null) : null, coverHeadline: row.coverHeadline, stories: [] };
    byEdition.set(row.editionId, g);
    groups.push(g);
  }
  for (const story of stories) byEdition.get(story.editionId)!.stories.push(story);
  if (ranks) groups.sort((a, b) => Math.max(...b.stories.map((x) => x.rank)) - Math.max(...a.stories.map((x) => x.rank)));
  return { groups, total: stories.length };
}

export type ArchiveEdition = {
  id: string;
  label: string;
  /** The newsletter this issue belongs to, for the masthead on its cover. */
  publicationName: string;
  issueLabel: string;
  title: string;
  status: string;
  isSpecialIssue: boolean;
  publishedAt: Date | null;
  publicationTargetAt: Date | null;
  coverUrl: string | null;
  coverHeadline: string | null;
  stories: number;
  pageCount: number | null;
  version: { id: string; label: string; kind: string; createdAt: Date } | null;
  downloads: { kind: "PDF" | "DOCX"; url: string; fileName: string; sizeBytes: number }[];
};

/** Every edition with its cover and the downloads of its latest READY publication version. */
export async function archiveEditions(): Promise<ArchiveEdition[]> {
  const editions = await db.select().from(s.editions).orderBy(desc(s.editions.year), desc(s.editions.month), desc(s.editions.issueNumber));
  if (!editions.length) return [];
  const ids = editions.map((e) => e.id);
  const storyCounts = await db.select({ editionId: s.stories.editionId, n: sql<number>`count(*)` }).from(s.stories).where(and(inArray(s.stories.editionId, ids), inArray(s.stories.status, [...ARCHIVE_STORY_STATUSES]))).groupBy(s.stories.editionId);
  const countMap = new Map(storyCounts.map((r) => [r.editionId, Number(r.n)]));
  const versions = await db
    .selectDistinctOn([s.publicationVersions.editionId])
    .from(s.publicationVersions)
    .where(and(inArray(s.publicationVersions.editionId, ids), eq(s.publicationVersions.status, "READY")))
    .orderBy(s.publicationVersions.editionId, desc(s.publicationVersions.sequence));
  const versionMap = new Map(versions.map((v) => [v.editionId, v]));
  const assets = versions.length ? await db.select().from(s.publicationAssets).where(inArray(s.publicationAssets.versionId, versions.map((v) => v.id))) : [];
  const storage = await getStorage();
  // Each issue's own masthead. One query for the lot; the workspace setting answers for an issue
  // that belongs to no title.
  const titleIds = [...new Set(editions.map((e) => e.publicationId).filter((id): id is string => !!id))];
  const titles = titleIds.length
    ? new Map((await db.select({ id: s.publications.id, name: s.publications.name }).from(s.publications).where(inArray(s.publications.id, titleIds))).map((row) => [row.id, row.name]))
    : new Map<string, string>();
  const fallbackName = (await workspaceMasthead()).name;
  const coverIds = editions.map((e) => e.coverMediaAssetId).filter((v): v is string => !!v);
  const covers = coverIds.length ? await mediaUrls(coverIds, "WEB") : {};
  const out: ArchiveEdition[] = [];
  for (const e of editions) {
    const version = versionMap.get(e.id) ?? null;
    const downloads: ArchiveEdition["downloads"] = [];
    let pageCount: number | null = null;
    if (version) {
      for (const asset of assets.filter((a) => a.versionId === version.id && (a.kind === "PDF" || a.kind === "DOCX"))) {
        const fileName = `${e.slug}-${version.label}.${asset.kind === "PDF" ? "pdf" : "docx"}`;
        downloads.push({ kind: asset.kind as "PDF" | "DOCX", url: await storage.getSignedUrl(asset.storageKey, { expiresInSeconds: 3600, download: { fileName } }), fileName, sizeBytes: asset.sizeBytes });
        if (asset.kind === "PDF" && asset.pageCount) pageCount = asset.pageCount;
      }
    }
    out.push({
      id: e.id,
      label: e.label,
      publicationName: (e.publicationId ? titles.get(e.publicationId) : null) ?? fallbackName,
      issueLabel: `${e.isSpecialIssue ? "Special issue" : "Issue"} N°${e.issueNumber}`,
      title: e.title,
      status: e.status,
      isSpecialIssue: e.isSpecialIssue,
      publishedAt: e.publishedAt,
      publicationTargetAt: e.publicationTargetAt,
      coverUrl: e.coverMediaAssetId ? (covers[e.coverMediaAssetId] ?? null) : null,
      coverHeadline: e.coverHeadline,
      stories: countMap.get(e.id) ?? 0,
      pageCount,
      version: version ? { id: version.id, label: version.label, kind: version.kind, createdAt: version.createdAt } : null,
      downloads,
    });
  }
  return out;
}

export type BddFilters = { q?: string; campusId?: string; editionId?: string; program?: string };

export async function listBdds(filters: BddFilters = {}, limit = 200) {
  const where: SQL[] = [];
  if (filters.campusId) where.push(eq(s.businessDeepDives.campusId, filters.campusId));
  if (filters.editionId) where.push(eq(s.businessDeepDives.editionId, filters.editionId));
  if (filters.program) where.push(eq(s.businessDeepDives.programCode, filters.program));
  if (filters.q?.trim()) {
    const like = `%${filters.q.trim()}%`;
    where.push(or(ilike(s.businessDeepDives.companyName, like), ilike(s.businessDeepDives.cohortLabel, like), ilike(s.businessDeepDives.theMethods, like), sql`array_to_string(${s.businessDeepDives.technologies}, ' ') ilike ${like}`, sql`${s.businessDeepDives.winningTeam}::text ilike ${like}`)!);
  }
  const rows = await db
    .select({
      id: s.businessDeepDives.id,
      storyId: s.businessDeepDives.storyId,
      companyName: s.businessDeepDives.companyName,
      cohortLabel: s.businessDeepDives.cohortLabel,
      programCode: s.businessDeepDives.programCode,
      dateText: s.businessDeepDives.dateText,
      theMethods: s.businessDeepDives.theMethods,
      technologies: s.businessDeepDives.technologies,
      winningTeam: s.businessDeepDives.winningTeam,
      jury: s.businessDeepDives.jury,
      campusName: s.campuses.name,
      campusColour: s.campuses.colour,
      editionId: s.businessDeepDives.editionId,
      editionLabel: s.editions.label,
      year: s.editions.year,
      month: s.editions.month,
      storyTitle: s.stories.title,
      headline: s.articles.headline,
    })
    .from(s.businessDeepDives)
    .innerJoin(s.stories, eq(s.stories.id, s.businessDeepDives.storyId))
    .innerJoin(s.editions, eq(s.editions.id, s.businessDeepDives.editionId))
    .leftJoin(s.articles, eq(s.articles.storyId, s.stories.id))
    .leftJoin(s.campuses, eq(s.campuses.id, s.businessDeepDives.campusId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.editions.year), desc(s.editions.month), asc(s.businessDeepDives.companyName))
    .limit(limit);
  return rows;
}

export type BddRow = Awaited<ReturnType<typeof listBdds>>[number];

export type PersonRow = { id: string; fullName: string; role: string | null; campusName: string | null; campusColour: string | null; mentionsCount: number; stories: { id: string; title: string; role: string; editionLabel: string }[] };

export async function listPeople(filters: { q?: string; role?: string } = {}, limit = 300): Promise<PersonRow[]> {
  const where: SQL[] = [];
  if (filters.q?.trim()) where.push(ilike(s.people.fullName, `%${filters.q.trim()}%`));
  if (filters.role) where.push(sql`exists (select 1 from ${s.storyPeople} sp where sp.person_id = ${s.people.id} and sp.role::text = ${filters.role})`);
  const people = await db
    .select({ id: s.people.id, fullName: s.people.fullName, role: s.people.role, campusName: s.campuses.name, campusColour: s.campuses.colour, mentionsCount: s.people.mentionsCount })
    .from(s.people)
    .leftJoin(s.campuses, eq(s.campuses.id, s.people.campusId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.people.mentionsCount), asc(s.people.fullName))
    .limit(limit);
  if (!people.length) return [];
  const links = await db
    .select({ personId: s.storyPeople.personId, storyId: s.stories.id, title: s.stories.title, role: s.storyPeople.role, editionLabel: s.editions.label, year: s.editions.year, month: s.editions.month })
    .from(s.storyPeople)
    .innerJoin(s.stories, eq(s.stories.id, s.storyPeople.storyId))
    .innerJoin(s.editions, eq(s.editions.id, s.stories.editionId))
    .where(inArray(s.storyPeople.personId, people.map((p) => p.id)))
    .orderBy(desc(s.editions.year), desc(s.editions.month));
  const byPerson = new Map<string, PersonRow["stories"]>();
  for (const l of links) byPerson.set(l.personId, [...(byPerson.get(l.personId) ?? []), { id: l.storyId, title: l.title, role: l.role, editionLabel: l.editionLabel }]);
  return people.map((p) => ({ ...p, stories: byPerson.get(p.id) ?? [] }));
}

export type OrganisationRow = { id: string; name: string; type: string; website: string | null; mentionsCount: number; stories: { id: string; title: string; role: string; editionLabel: string }[] };

export async function listOrganisations(filters: { q?: string; type?: string } = {}, limit = 300): Promise<OrganisationRow[]> {
  const where: SQL[] = [];
  if (filters.q?.trim()) where.push(ilike(s.organisations.name, `%${filters.q.trim()}%`));
  if (filters.type) where.push(sql`${s.organisations.type}::text = ${filters.type}`);
  const orgs = await db
    .select({ id: s.organisations.id, name: s.organisations.name, type: s.organisations.type, website: s.organisations.website, mentionsCount: s.organisations.mentionsCount })
    .from(s.organisations)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(s.organisations.mentionsCount), asc(s.organisations.name))
    .limit(limit);
  if (!orgs.length) return [];
  const links = await db
    .select({ organisationId: s.storyOrganisations.organisationId, storyId: s.stories.id, title: s.stories.title, role: s.storyOrganisations.role, editionLabel: s.editions.label, year: s.editions.year, month: s.editions.month })
    .from(s.storyOrganisations)
    .innerJoin(s.stories, eq(s.stories.id, s.storyOrganisations.storyId))
    .innerJoin(s.editions, eq(s.editions.id, s.stories.editionId))
    .where(inArray(s.storyOrganisations.organisationId, orgs.map((o) => o.id)))
    .orderBy(desc(s.editions.year), desc(s.editions.month));
  const byOrg = new Map<string, OrganisationRow["stories"]>();
  for (const l of links) byOrg.set(l.organisationId, [...(byOrg.get(l.organisationId) ?? []), { id: l.storyId, title: l.title, role: l.role, editionLabel: l.editionLabel }]);
  return orgs.map((o) => ({ ...o, stories: byOrg.get(o.id) ?? [] }));
}

export async function archiveFilterOptions() {
  const [campuses, editions, sections, programs] = await Promise.all([
    db.select({ id: s.campuses.id, name: s.campuses.name }).from(s.campuses).where(eq(s.campuses.isActive, true)).orderBy(asc(s.campuses.sortOrder)),
    db.select({ id: s.editions.id, label: s.editions.label }).from(s.editions).orderBy(desc(s.editions.year), desc(s.editions.month)),
    db.select({ slug: s.editionSections.slug, name: sql<string>`min(${s.editionSections.name})`, order: sql<number>`min(${s.editionSections.sortOrder})` }).from(s.editionSections).groupBy(s.editionSections.slug).orderBy(sql`min(${s.editionSections.sortOrder})`),
    db.selectDistinct({ code: s.businessDeepDives.programCode }).from(s.businessDeepDives).orderBy(s.businessDeepDives.programCode),
  ]);
  const [stats] = await db
    .select({
      stories: sql<number>`(select count(*) from ${s.stories} where ${s.stories.status} in ('SELECTED', 'DRAFTING', 'IN_REVIEW', 'APPROVED', 'PUBLISHED'))`,
      people: sql<number>`(select count(*) from ${s.people})`,
      organisations: sql<number>`(select count(*) from ${s.organisations})`,
      bdds: sql<number>`(select count(*) from ${s.businessDeepDives})`,
    })
    .from(sql`(select 1) as one`);
  return {
    campuses,
    editions,
    sections: sections.map((sec) => ({ slug: sec.slug, name: sec.name })),
    storyTypes: STORY_TYPES.map((t) => ({ value: t.value, label: t.label })),
    programs: programs.map((p) => p.code).filter((c): c is string => !!c),
    stats: { stories: Number(stats?.stories ?? 0), people: Number(stats?.people ?? 0), organisations: Number(stats?.organisations ?? 0), bdds: Number(stats?.bdds ?? 0) },
  };
}
