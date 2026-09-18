import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { slugify } from "@/lib/utils";
import { showableEditions } from "./service";

/**
 * Curating the gallery: what a super admin does, and nothing a curator does can widen what may be
 * shown. Adding an edition whose title has not consented creates a row that draws nothing, and the
 * console says so on the item rather than silently dropping it — a curator who cannot see why their
 * collection is short will add it twice.
 */

export const collectionSchema = z.object({
  title: z.string().trim().min(2, "Give the collection a name").max(120),
  slug: z.string().trim().max(120).optional(),
  tagline: z.string().trim().max(240).optional().nullable(),
  description: z.string().trim().max(2000).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  language: z.string().trim().max(10).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  coverUrl: z.string().trim().url("Give a full address").max(2000).optional().nullable().or(z.literal("")),
  coverMediaAssetId: z.string().uuid().optional().nullable(),
  isPublished: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  pinnedOrder: z.number().int().min(0).max(99).optional().nullable(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  seoTitle: z.string().trim().max(120).optional().nullable(),
  seoDescription: z.string().trim().max(320).optional().nullable(),
});
export type CollectionInput = z.infer<typeof collectionSchema>;

async function uniqueSlug(wanted: string, exceptId?: string) {
  const base = slugify(wanted) || "collection";
  for (let n = 0; n < 50; n += 1) {
    const candidate = n ? `${base}-${n + 1}` : base;
    const clash = await db.query.collections.findFirst({ where: eq(s.collections.slug, candidate), columns: { id: true } });
    if (!clash || clash.id === exceptId) return candidate;
  }
  throw new ValidationError("Too many collections with that name", { title: ["Choose another name"] });
}

export async function createCollection(raw: z.input<typeof collectionSchema>, userId?: string | null) {
  const input = collectionSchema.parse(raw);
  const slug = await uniqueSlug(input.slug || input.title);
  const [row] = await db
    .insert(s.collections)
    .values({
      slug,
      title: input.title,
      tagline: input.tagline ?? null,
      description: input.description ?? null,
      category: input.category ?? null,
      language: input.language ?? null,
      tags: input.tags ?? [],
      coverUrl: input.coverUrl || null,
      coverMediaAssetId: input.coverMediaAssetId ?? null,
      isPublished: input.isPublished ?? false,
      isFeatured: input.isFeatured ?? false,
      pinnedOrder: input.pinnedOrder ?? null,
      sortOrder: input.sortOrder ?? 0,
      seoTitle: input.seoTitle ?? null,
      seoDescription: input.seoDescription ?? null,
      createdById: userId ?? null,
    })
    .returning();
  await audit({ action: "collection.create", userId, entityType: "SETTING", entityId: row.id, metadata: { slug, title: row.title } });
  return row;
}

export async function updateCollection(id: string, raw: Partial<z.input<typeof collectionSchema>>, userId?: string | null) {
  const existing = await db.query.collections.findFirst({ where: eq(s.collections.id, id) });
  if (!existing) throw new NotFoundError("Collection");
  const input = collectionSchema.partial().parse(raw);
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) if (value !== undefined) patch[key] = value === "" ? null : value;
  if (input.slug || (input.title && input.title !== existing.title)) patch.slug = await uniqueSlug(input.slug || input.title!, id);
  const [row] = await db.update(s.collections).set(patch).where(eq(s.collections.id, id)).returning();
  await audit({ action: "collection.update", userId, entityType: "SETTING", entityId: id, metadata: { fields: Object.keys(patch) } });
  return row;
}

export async function deleteCollection(id: string, userId?: string | null) {
  const existing = await db.query.collections.findFirst({ where: eq(s.collections.id, id) });
  if (!existing) throw new NotFoundError("Collection");
  await db.delete(s.collections).where(eq(s.collections.id, id));
  await audit({ action: "collection.delete", userId, entityType: "SETTING", entityId: id, metadata: { title: existing.title } });
}

export async function addToCollection(collectionId: string, editionIds: string[], userId?: string | null) {
  if (!editionIds.length) return 0;
  const [last] = await db.select({ max: sql<number>`coalesce(max(${s.collectionItems.sortOrder}), -1)` }).from(s.collectionItems).where(eq(s.collectionItems.collectionId, collectionId));
  let next = Number(last?.max ?? -1) + 1;
  const values = editionIds.map((editionId) => ({ collectionId, editionId, sortOrder: next++, addedById: userId ?? null }));
  await db.insert(s.collectionItems).values(values).onConflictDoNothing();
  await audit({ action: "collection.items.add", userId, entityType: "SETTING", entityId: collectionId, metadata: { count: editionIds.length } });
  return editionIds.length;
}

export async function removeFromCollection(collectionId: string, editionIds: string[], userId?: string | null) {
  if (!editionIds.length) return 0;
  await db.delete(s.collectionItems).where(and(eq(s.collectionItems.collectionId, collectionId), inArray(s.collectionItems.editionId, editionIds)));
  await audit({ action: "collection.items.remove", userId, entityType: "SETTING", entityId: collectionId, metadata: { count: editionIds.length } });
  return editionIds.length;
}

/** The order a curator dragged the grid into, written in one go so no item is ever half-moved. */
export async function reorderCollection(collectionId: string, editionIds: string[], userId?: string | null) {
  await db.transaction(async (tx) => {
    for (const [index, editionId] of editionIds.entries()) {
      await tx.update(s.collectionItems).set({ sortOrder: index }).where(and(eq(s.collectionItems.collectionId, collectionId), eq(s.collectionItems.editionId, editionId)));
    }
  });
  await audit({ action: "collection.items.reorder", userId, entityType: "SETTING", entityId: collectionId, metadata: { count: editionIds.length } });
}

export async function setItem(collectionId: string, editionId: string, patch: { isFeatured?: boolean; blurb?: string | null }, userId?: string | null) {
  const values: Record<string, unknown> = {};
  if (patch.isFeatured !== undefined) values.isFeatured = patch.isFeatured;
  if (patch.blurb !== undefined) values.blurb = patch.blurb?.trim() || null;
  if (!Object.keys(values).length) return;
  await db.update(s.collectionItems).set(values).where(and(eq(s.collectionItems.collectionId, collectionId), eq(s.collectionItems.editionId, editionId)));
  await audit({ action: "collection.items.update", userId, entityType: "SETTING", entityId: collectionId, metadata: { editionId, fields: Object.keys(values) } });
}

/** Every collection as the console lists them: draft and published alike, with what each can show. */
export async function adminCollections() {
  const rows = await db.select().from(s.collections).orderBy(s.collections.sortOrder, s.collections.title);
  if (!rows.length) return [];
  const items = await db.select({ collectionId: s.collectionItems.collectionId, editionId: s.collectionItems.editionId }).from(s.collectionItems);
  const allowed = new Set((await showableEditions({ editionIds: [...new Set(items.map((i) => i.editionId))] })).map((e) => e.editionId));
  const views = await db
    .select({ collectionId: s.showcaseEvents.collectionId, kind: s.showcaseEvents.kind, n: sql<number>`count(*)` })
    .from(s.showcaseEvents)
    .groupBy(s.showcaseEvents.collectionId, s.showcaseEvents.kind);
  return rows.map((row) => {
    const mine = items.filter((i) => i.collectionId === row.id);
    const stat = (kind: string) => Number(views.find((v) => v.collectionId === row.id && v.kind === kind)?.n ?? 0);
    const seen = stat("COLLECTION_VIEW");
    const signups = stat("SIGNUP_CLICK");
    return {
      ...row,
      total: mine.length,
      showable: mine.filter((i) => allowed.has(i.editionId)).length,
      views: seen,
      opens: stat("ITEM_OPEN"),
      signupClicks: signups,
      clickThrough: seen ? signups / seen : null,
    };
  });
}

/** One collection for the console, with every item and why an item may not be showing. */
export async function adminCollection(id: string) {
  const collection = await db.query.collections.findFirst({ where: eq(s.collections.id, id) });
  if (!collection) return null;
  const items = await db.select().from(s.collectionItems).where(eq(s.collectionItems.collectionId, id)).orderBy(s.collectionItems.sortOrder, s.collectionItems.addedAt);
  const ids = items.map((i) => i.editionId);
  const showable = new Map((await showableEditions({ editionIds: ids })).map((e) => [e.editionId, e]));
  const rows = ids.length
    ? await db
        .select({
          editionId: s.editions.id,
          label: s.editions.label,
          title: s.editions.title,
          status: s.editions.status,
          organization: s.organizations.name,
          publication: s.publications.name,
          consent: s.publications.showcaseConsent,
        })
        .from(s.editions)
        .leftJoin(s.organizations, eq(s.organizations.id, s.editions.organizationId))
        .leftJoin(s.publications, eq(s.publications.id, s.editions.publicationId))
        .where(inArray(s.editions.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.editionId, r]));
  return {
    collection,
    items: items.map((item) => {
      const row = byId.get(item.editionId);
      const visible = showable.get(item.editionId);
      return {
        ...item,
        label: row?.label ?? "—",
        title: row?.title ?? "—",
        organization: row?.organization ?? "—",
        publication: row?.publication ?? null,
        showing: Boolean(visible),
        coverUrl: visible?.coverUrl ?? null,
        href: visible?.href ?? null,
        // The one sentence a curator needs when an item is in the list and not on the page.
        why: visible
          ? null
          : row?.consent === "NONE"
            ? "Its title has not agreed to be shown."
            : row?.status !== "PUBLISHED" && row?.status !== "ARCHIVED"
              ? "It has not been published yet."
              : "It has no public web page, so there is nothing to open.",
      };
    }),
  };
}

/** How the gallery is doing, for the console. */
export async function showcaseOverview() {
  const [totals] = await db
    .select({
      galleryViews: sql<number>`count(*) filter (where ${s.showcaseEvents.kind} = 'GALLERY_VIEW')`,
      collectionViews: sql<number>`count(*) filter (where ${s.showcaseEvents.kind} = 'COLLECTION_VIEW')`,
      opens: sql<number>`count(*) filter (where ${s.showcaseEvents.kind} = 'ITEM_OPEN')`,
      signupClicks: sql<number>`count(*) filter (where ${s.showcaseEvents.kind} = 'SIGNUP_CLICK')`,
    })
    .from(s.showcaseEvents);
  const top = await db
    .select({ editionId: s.showcaseEvents.editionId, label: s.editions.label, title: s.editions.title, organization: s.organizations.name, n: sql<number>`count(*)` })
    .from(s.showcaseEvents)
    .innerJoin(s.editions, eq(s.editions.id, s.showcaseEvents.editionId))
    .leftJoin(s.organizations, eq(s.organizations.id, s.editions.organizationId))
    .where(eq(s.showcaseEvents.kind, "ITEM_OPEN"))
    .groupBy(s.showcaseEvents.editionId, s.editions.label, s.editions.title, s.organizations.name)
    .orderBy(sql`count(*) desc`)
    .limit(10);
  const views = Number(totals?.galleryViews ?? 0) + Number(totals?.collectionViews ?? 0);
  const signupClicks = Number(totals?.signupClicks ?? 0);
  return {
    galleryViews: Number(totals?.galleryViews ?? 0),
    collectionViews: Number(totals?.collectionViews ?? 0),
    opens: Number(totals?.opens ?? 0),
    signupClicks,
    clickThrough: views ? signupClicks / views : null,
    top: top.map((row) => ({ ...row, n: Number(row.n) })),
  };
}
