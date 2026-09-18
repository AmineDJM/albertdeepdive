import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { mediaUrls } from "@/server/media/urls";
import type { OutputFormat } from "@/server/outputs/service";

/**
 * The public gallery.
 *
 * Everything a visitor sees comes through `showable`, and `showable` is the privacy model in one
 * expression. An edition may be shown only when all four hold:
 *
 *   1. its title's owner said so — `showcaseConsent` is not `NONE`, set by the customer, or by a
 *      super admin for a demo workspace, or recorded as a permission given elsewhere;
 *   2. the edition itself is published or archived, never a draft;
 *   3. it already has a published web address, so the gallery only ever links to a page the world
 *      could already open — the gallery cannot make anything public, only point at what is;
 *   4. its workspace is active.
 *
 * A curator putting an edition in a collection does not change any of that. A row in
 * `collection_items` for an edition that fails the test is simply not returned, so a consent
 * withdrawn at four o'clock empties the gallery of that customer's work at four o'clock, with no
 * cache to purge and no curator to chase.
 */

export type GalleryItem = {
  editionId: string;
  title: string;
  label: string;
  organization: string;
  organizationSlug: string;
  publication: string | null;
  /** What kind of thing it is: a newsletter, a magazine, a report. */
  kind: string;
  description: string | null;
  category: string | null;
  language: string;
  formats: OutputFormat[];
  coverUrl: string | null;
  /** The address anyone can open: the edition's own public web page. */
  href: string;
  publishedAt: Date | null;
  views: number;
  isFeatured: boolean;
};

export type CollectionCard = {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  category: string | null;
  language: string | null;
  tags: string[];
  coverUrl: string | null;
  isFeatured: boolean;
  pinnedOrder: number | null;
  count: number;
  views: number;
};

/** The four conditions, as one SQL predicate, used by every public read. */
function showable() {
  return and(
    sql`${s.publications.showcaseConsent} <> 'NONE'`,
    inArray(s.editions.status, ["PUBLISHED", "ARCHIVED"]),
    eq(s.organizations.status, "ACTIVE"),
    eq(s.editionOutputs.format, "WEB"),
    eq(s.editionOutputs.status, "PUBLISHED"),
    isNotNull(s.editionOutputs.publicSlug),
  );
}

const KIND_BY_CADENCE: Record<string, string> = { weekly: "Weekly newsletter", fortnightly: "Newsletter", monthly: "Monthly edition", quarterly: "Quarterly report", irregular: "Publication" };

/** Every edition the gallery is allowed to show, with what a card needs to draw it. */
export async function showableEditions(options: { editionIds?: string[]; limit?: number } = {}) {
  const rows = await db
    .select({
      editionId: s.editions.id,
      title: s.editions.title,
      label: s.editions.label,
      coverMediaAssetId: s.editions.coverMediaAssetId,
      coverHeadline: s.editions.coverHeadline,
      coverStandfirst: s.editions.coverStandfirst,
      publishedAt: s.editions.publishedAt,
      publicSlug: s.editionOutputs.publicSlug,
      organization: s.organizations.name,
      organizationSlug: s.organizations.slug,
      organizationType: s.organizations.type,
      organizationId: s.organizations.id,
      publication: s.publications.name,
      publicationDescription: s.publications.description,
      cadence: s.publications.cadence,
      language: s.publications.language,
    })
    .from(s.editions)
    .innerJoin(s.publications, eq(s.publications.id, s.editions.publicationId))
    .innerJoin(s.organizations, eq(s.organizations.id, s.editions.organizationId))
    .innerJoin(s.editionOutputs, eq(s.editionOutputs.editionId, s.editions.id))
    .where(options.editionIds?.length ? and(showable(), inArray(s.editions.id, options.editionIds)) : showable())
    .orderBy(desc(s.editions.publishedAt))
    .limit(options.limit ?? 200);

  const ids = rows.map((r) => r.editionId);
  const [covers, formats, views] = await Promise.all([resolveCovers(rows), formatsFor(ids), viewsByEdition(ids)]);
  return rows.map((row): GalleryItem => ({
    editionId: row.editionId,
    title: row.coverHeadline || row.title,
    label: row.label,
    organization: row.organization,
    organizationSlug: row.organizationSlug,
    publication: row.publication,
    kind: KIND_BY_CADENCE[row.cadence] ?? "Publication",
    description: row.coverStandfirst || row.publicationDescription,
    category: row.organizationType,
    language: row.language,
    formats: formats.get(row.editionId) ?? [],
    coverUrl: covers.get(row.editionId) ?? null,
    href: `/r/${row.publicSlug}`,
    publishedAt: row.publishedAt,
    views: views.get(row.editionId) ?? 0,
    isFeatured: false,
  }));
}

async function resolveCovers(rows: { editionId: string; coverMediaAssetId: string | null }[]) {
  const assetIds = rows.map((r) => r.coverMediaAssetId).filter((id): id is string => Boolean(id));
  const urls = assetIds.length ? await mediaUrls(assetIds, "WEB") : {};
  return new Map(rows.map((r) => [r.editionId, (r.coverMediaAssetId ? urls[r.coverMediaAssetId] : null) ?? null]));
}

/** Which shapes each edition went out in, so a card can say "Email · Web · PDF". */
async function formatsFor(editionIds: string[]) {
  const map = new Map<string, OutputFormat[]>();
  if (!editionIds.length) return map;
  const rows = await db
    .select({ editionId: s.editionOutputs.editionId, format: s.editionOutputs.format })
    .from(s.editionOutputs)
    .where(and(inArray(s.editionOutputs.editionId, editionIds), eq(s.editionOutputs.status, "PUBLISHED")));
  for (const row of rows) map.set(row.editionId, [...(map.get(row.editionId) ?? []), row.format]);
  return map;
}

async function viewsByEdition(editionIds: string[]) {
  const map = new Map<string, number>();
  if (!editionIds.length) return map;
  const rows = await db
    .select({ editionId: s.showcaseEvents.editionId, n: sql<number>`count(*)` })
    .from(s.showcaseEvents)
    .where(and(inArray(s.showcaseEvents.editionId, editionIds), eq(s.showcaseEvents.kind, "ITEM_OPEN")))
    .groupBy(s.showcaseEvents.editionId);
  for (const row of rows) if (row.editionId) map.set(row.editionId, Number(row.n));
  return map;
}

/** Published collections, with how many editions each can actually show right now. */
export async function publicCollections(): Promise<CollectionCard[]> {
  const rows = await db.select().from(s.collections).where(eq(s.collections.isPublished, true)).orderBy(s.collections.sortOrder, s.collections.title);
  if (!rows.length) return [];
  const items = await db.select({ collectionId: s.collectionItems.collectionId, editionId: s.collectionItems.editionId }).from(s.collectionItems).where(inArray(s.collectionItems.collectionId, rows.map((r) => r.id)));
  const allowed = new Set((await showableEditions({ editionIds: [...new Set(items.map((i) => i.editionId))] })).map((e) => e.editionId));
  const counts = new Map<string, number>();
  for (const item of items) if (allowed.has(item.editionId)) counts.set(item.collectionId, (counts.get(item.collectionId) ?? 0) + 1);
  const views = await viewsByCollection(rows.map((r) => r.id));
  const covers = await resolveCollectionCovers(rows);
  return rows
    // A collection with nothing to show is not a collection; it is a promise the page cannot keep.
    .filter((row) => (counts.get(row.id) ?? 0) > 0)
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      tagline: row.tagline,
      description: row.description,
      category: row.category,
      language: row.language,
      tags: row.tags,
      coverUrl: covers.get(row.id) ?? null,
      isFeatured: row.isFeatured,
      pinnedOrder: row.pinnedOrder,
      count: counts.get(row.id) ?? 0,
      views: views.get(row.id) ?? 0,
    }));
}

async function resolveCollectionCovers(rows: { id: string; coverMediaAssetId: string | null; coverUrl: string | null }[]) {
  const assetIds = rows.map((r) => r.coverMediaAssetId).filter((id): id is string => Boolean(id));
  const urls = assetIds.length ? await mediaUrls(assetIds, "WEB") : {};
  return new Map(rows.map((r) => [r.id, (r.coverMediaAssetId ? urls[r.coverMediaAssetId] : null) ?? r.coverUrl ?? null]));
}

async function viewsByCollection(ids: string[]) {
  const map = new Map<string, number>();
  if (!ids.length) return map;
  const rows = await db
    .select({ collectionId: s.showcaseEvents.collectionId, n: sql<number>`count(*)` })
    .from(s.showcaseEvents)
    .where(and(inArray(s.showcaseEvents.collectionId, ids), eq(s.showcaseEvents.kind, "COLLECTION_VIEW")))
    .groupBy(s.showcaseEvents.collectionId);
  for (const row of rows) if (row.collectionId) map.set(row.collectionId, Number(row.n));
  return map;
}

/** One collection and the editions it may show, in the curator's order. */
export async function publicCollection(slug: string) {
  const collection = await db.query.collections.findFirst({ where: and(eq(s.collections.slug, slug), eq(s.collections.isPublished, true)) });
  if (!collection) return null;
  const items = await db.select().from(s.collectionItems).where(eq(s.collectionItems.collectionId, collection.id)).orderBy(s.collectionItems.sortOrder, s.collectionItems.addedAt);
  const editions = await showableEditions({ editionIds: items.map((i) => i.editionId) });
  const byId = new Map(editions.map((e) => [e.editionId, e]));
  const ordered = items
    .map((item) => {
      const edition = byId.get(item.editionId);
      return edition ? { ...edition, description: item.blurb ?? edition.description, isFeatured: item.isFeatured } : null;
    })
    .filter((item): item is GalleryItem => item !== null);
  const covers = await resolveCollectionCovers([collection]);
  return { collection: { ...collection, coverUrl: covers.get(collection.id) ?? ordered.find((i) => i.isFeatured)?.coverUrl ?? ordered[0]?.coverUrl ?? null }, items: ordered };
}

/**
 * Note what a visitor did, without learning anything about them.
 *
 * Never throws and never blocks: a gallery that fails to load because its counter failed is worse
 * than a counter that missed a view.
 */
export async function recordShowcaseEvent(input: { kind: (typeof s.showcaseEventEnum.enumValues)[number]; collectionId?: string | null; editionId?: string | null; organizationId?: string | null }) {
  try {
    await db.insert(s.showcaseEvents).values({
      kind: input.kind,
      collectionId: input.collectionId ?? null,
      editionId: input.editionId ?? null,
      organizationId: input.organizationId ?? null,
      day: new Date().toISOString().slice(0, 10),
    });
  } catch {
    // Counting is never worth an error page.
  }
}

/** The categories and languages the gallery actually has something in, for its filters. */
export function facetsFor(items: GalleryItem[], collections: CollectionCard[]) {
  const categories = new Map<string, number>();
  const languages = new Map<string, number>();
  for (const item of items) {
    if (item.category) categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
    languages.set(item.language, (languages.get(item.language) ?? 0) + 1);
  }
  for (const collection of collections) if (collection.category) categories.set(collection.category, categories.get(collection.category) ?? 0);
  return {
    categories: [...categories.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    languages: [...languages.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count),
  };
}

/** Free-text search over what a visitor can see on a card. */
export function matches(item: GalleryItem, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.label, item.organization, item.publication, item.description, item.kind, item.category].filter(Boolean).some((field) => field!.toLowerCase().includes(q));
}

export { showable as showablePredicate };
