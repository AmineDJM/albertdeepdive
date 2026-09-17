import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { OutputConfig } from "@/server/db/schema/outputs";
import { audit } from "@/server/audit";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { slugify } from "@/lib/utils";
import { guardTenant } from "@/server/tenancy/scope";

export const OUTPUT_FORMATS = ["EMAIL", "WEB", "MAGAZINE", "PRINT"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const OUTPUT_LABELS: Record<OutputFormat, string> = {
  EMAIL: "Email",
  WEB: "Web",
  MAGAZINE: "Magazine",
  PRINT: "Print",
};

export const OUTPUT_DESCRIPTIONS: Record<OutputFormat, string> = {
  EMAIL: "Sent to the people subscribed to this title.",
  WEB: "A page anyone with the link can read.",
  MAGAZINE: "A laid-out PDF, ready to read on screen.",
  PRINT: "Print-ready files for a printer or a provider.",
};

/**
 * Which formats an edition is published in.
 *
 * Outputs are created on demand rather than up front: an edition that will only ever be an email
 * should not carry three rows saying "not configured". Turning a format on creates its row; turning
 * it off deletes it, unless it has already been published — a sent email cannot be un-sent, and the
 * record of it is part of the edition's history.
 */

export type EditionOutput = typeof s.editionOutputs.$inferSelect;

export async function listOutputs(editionId: string): Promise<EditionOutput[]> {
  return db.query.editionOutputs.findMany({
    where: eq(s.editionOutputs.editionId, editionId),
    orderBy: [asc(s.editionOutputs.createdAt)],
  });
}

/** Every format, with the ones not yet enabled shown as absent rather than invented. */
export async function outputMatrix(editionId: string) {
  const rows = await listOutputs(editionId);
  const byFormat = new Map(rows.map((r) => [r.format, r]));
  return OUTPUT_FORMATS.map((format) => ({
    format,
    label: OUTPUT_LABELS[format],
    description: OUTPUT_DESCRIPTIONS[format],
    output: byFormat.get(format) ?? null,
  }));
}

async function editionOrThrow(editionId: string) {
  const edition = await guardTenant(
    await db.query.editions.findFirst({ where: eq(s.editions.id, editionId), columns: { id: true, organizationId: true, slug: true, title: true, label: true, publicationId: true } }),
    "Edition",
  );
  if (!edition) throw new NotFoundError("Edition");
  return edition;
}

export async function enableOutput(editionId: string, format: OutputFormat, userId?: string | null): Promise<EditionOutput> {
  const edition = await editionOrThrow(editionId);
  const existing = await db.query.editionOutputs.findFirst({ where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, format)) });
  if (existing) return existing;

  const config: OutputConfig = format === "EMAIL" ? { subject: edition.title } : {};
  const [row] = await db
    .insert(s.editionOutputs)
    .values({
      organizationId: edition.organizationId,
      editionId,
      format,
      status: "PENDING",
      config,
      publicSlug: format === "WEB" ? await uniqueWebSlug(edition.organizationId, edition.slug) : null,
      createdById: userId ?? null,
    })
    .returning();
  await audit({ action: "output.enable", organizationId: edition.organizationId, userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { format } });
  return row;
}

export async function disableOutput(editionId: string, format: OutputFormat, userId?: string | null) {
  const edition = await editionOrThrow(editionId);
  const existing = await db.query.editionOutputs.findFirst({ where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, format)) });
  if (!existing) return;
  // A sent email cannot be un-sent, and a published page that vanishes breaks every link to it.
  if (existing.status === "PUBLISHED") {
    throw new ValidationError(`${OUTPUT_LABELS[format]} has already been published and cannot be removed`);
  }
  await db.delete(s.editionOutputs).where(eq(s.editionOutputs.id, existing.id));
  await audit({ action: "output.disable", organizationId: edition.organizationId, userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { format } });
}

export async function updateOutputConfig(editionId: string, format: OutputFormat, patch: OutputConfig, userId?: string | null) {
  const edition = await editionOrThrow(editionId);
  const existing = await db.query.editionOutputs.findFirst({ where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, format)) });
  if (!existing) throw new NotFoundError("Output");
  const [row] = await db
    .update(s.editionOutputs)
    .set({ config: { ...existing.config, ...patch } })
    .where(eq(s.editionOutputs.id, existing.id))
    .returning();
  await audit({ action: "output.configure", organizationId: edition.organizationId, userId, entityType: "EDITION", entityId: editionId, editionId, metadata: { format, fields: Object.keys(patch) } });
  return row;
}

export async function setOutputStatus(
  outputId: string,
  status: (typeof s.outputStatusEnum.enumValues)[number],
  extra: Partial<Pick<EditionOutput, "versionId" | "providerCampaignId" | "recipientCount" | "lastError" | "generatedAt" | "publishedAt">> = {},
) {
  const [row] = await db.update(s.editionOutputs).set({ status, ...extra }).where(eq(s.editionOutputs.id, outputId)).returning();
  if (!row) throw new NotFoundError("Output");
  return row;
}

/** A web address is public and permanent, so it must be unique within the workspace. */
async function uniqueWebSlug(organizationId: string | null, base: string) {
  const root = slugify(base) || "edition";
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const clash = await db.query.editionOutputs.findFirst({
      where: and(
        organizationId ? eq(s.editionOutputs.organizationId, organizationId) : sql`${s.editionOutputs.organizationId} is null`,
        eq(s.editionOutputs.publicSlug, candidate),
      ),
      columns: { id: true },
    });
    if (!clash) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/**
 * Apply a publication's default formats to a new edition.
 *
 * Defaults are a starting point, not a rule: the edition can turn any of them off before it is
 * published, and turn on one the title does not usually use.
 */
export async function applyPublicationDefaults(editionId: string, userId?: string | null) {
  const edition = await editionOrThrow(editionId);
  if (!edition.publicationId) return [];
  const publication = await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId), columns: { defaultFormats: true } });
  const wanted = (publication?.defaultFormats ?? []).filter((f): f is OutputFormat => (OUTPUT_FORMATS as readonly string[]).includes(f));
  const created: EditionOutput[] = [];
  for (const format of wanted) created.push(await enableOutput(editionId, format, userId));
  return created;
}

/** Counts for the publications list: how many editions, and how many actually went out. */
export async function publicationStats(organizationId: string) {
  const rows = await db
    .select({
      publicationId: s.editions.publicationId,
      editions: sql<number>`count(distinct ${s.editions.id})`,
      published: sql<number>`count(distinct ${s.editions.id}) filter (where ${s.editions.status} = 'PUBLISHED')`,
    })
    .from(s.editions)
    .where(eq(s.editions.organizationId, organizationId))
    .groupBy(s.editions.publicationId);

  const subs = await db
    .select({ publicationId: s.publicationSubscriptions.publicationId, n: sql<number>`count(*)` })
    .from(s.publicationSubscriptions)
    .innerJoin(s.subscribers, eq(s.publicationSubscriptions.subscriberId, s.subscribers.id))
    .where(and(eq(s.subscribers.organizationId, organizationId), eq(s.publicationSubscriptions.isActive, true), eq(s.subscribers.status, "SUBSCRIBED")))
    .groupBy(s.publicationSubscriptions.publicationId);

  const editionCounts = new Map(rows.filter((r) => r.publicationId).map((r) => [r.publicationId!, { editions: Number(r.editions), published: Number(r.published) }]));
  const subCounts = new Map(subs.map((r) => [r.publicationId, Number(r.n)]));
  return { editionCounts, subCounts };
}

export async function listPublications(organizationId: string) {
  const [rows, { editionCounts, subCounts }] = await Promise.all([
    db.query.publications.findMany({ where: eq(s.publications.organizationId, organizationId), orderBy: [asc(s.publications.sortOrder), asc(s.publications.name)] }),
    publicationStats(organizationId),
  ]);
  return rows.map((p) => ({
    ...p,
    editions: editionCounts.get(p.id)?.editions ?? 0,
    published: editionCounts.get(p.id)?.published ?? 0,
    subscribers: subCounts.get(p.id) ?? 0,
  }));
}

/** Formats that went out, for the edition header and the archive. */
export async function publishedFormats(editionIds: string[]) {
  if (!editionIds.length) return new Map<string, OutputFormat[]>();
  const rows = await db
    .select({ editionId: s.editionOutputs.editionId, format: s.editionOutputs.format })
    .from(s.editionOutputs)
    .where(and(inArray(s.editionOutputs.editionId, editionIds), eq(s.editionOutputs.status, "PUBLISHED")));
  const map = new Map<string, OutputFormat[]>();
  for (const r of rows) map.set(r.editionId, [...(map.get(r.editionId) ?? []), r.format]);
  return map;
}
