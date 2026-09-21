import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { OutputConfig } from "@/server/db/schema/outputs";
import { audit } from "@/server/audit";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";
import { slugify } from "@/lib/utils";
import { guardTenant } from "@/server/tenancy/scope";
import { canPublishFormat } from "@/server/billing/entitlements";

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
  if (edition.organizationId && !(await canPublishFormat(edition.organizationId, format))) {
    throw new ForbiddenError(`${OUTPUT_LABELS[format]} is not included in your plan.`);
  }

  // No default subject on purpose. "Acme Weekly — Issue N°7" is a worse subject line than the cover
  // headline, which is the actual news; the renderer uses the headline unless an editor overrides it.
  const config: OutputConfig = {};
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

export type OutputStatusPatch = Partial<
  Pick<EditionOutput, "versionId" | "providerCampaignId" | "recipientCount" | "deliveredCount" | "openedCount" | "clickedCount" | "lastError" | "generatedAt" | "publishedAt" | "scheduledFor">
>;

export async function setOutputStatus(outputId: string, status: (typeof s.outputStatusEnum.enumValues)[number], extra: OutputStatusPatch = {}) {
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
  for (const format of wanted) {
    // A title whose usual formats include one the plan does not cover still creates its edition;
    // the format is simply not switched on. Failing here would make the plan block edition
    // creation outright, which is not what a limit on *publishing* should do.
    if (edition.organizationId && !(await canPublishFormat(edition.organizationId, format))) continue;
    created.push(await enableOutput(editionId, format, userId));
  }
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

/**
 * Every newsletter with the edition currently being made, for the shelf on Home.
 *
 * Home used to lead with editions, which is the wrong noun to lead with: a person does not have
 * "editions", they have a newsletter that produces one every month. So the shelf is the titles,
 * each showing where its current edition has got to — and a title with nothing in progress says
 * so, which is itself the prompt to start the next one.
 *
 * One query for the titles and one for their editions, rather than one per title: a workspace with
 * six newsletters should cost the same as a workspace with one.
 */
export async function newsletterShelf(organizationId: string) {
  const titles = await db.query.publications.findMany({
    where: eq(s.publications.organizationId, organizationId),
    orderBy: [asc(s.publications.sortOrder), asc(s.publications.name)],
    columns: { id: true, name: true, cadence: true, defaultFormats: true },
  });
  if (!titles.length) return [];

  const editions = await db
    .select({
      id: s.editions.id,
      publicationId: s.editions.publicationId,
      issueNumber: s.editions.issueNumber,
      label: s.editions.label,
      status: s.editions.status,
      publicationTargetAt: s.editions.publicationTargetAt,
    })
    .from(s.editions)
    .where(
      and(
        eq(s.editions.organizationId, organizationId),
        isNull(s.editions.hiddenAt),
        inArray(
          s.editions.publicationId,
          titles.map((title) => title.id),
        ),
      ),
    )
    .orderBy(desc(s.editions.year), desc(s.editions.month), desc(s.editions.issueNumber));

  return titles.map((title) => {
    const mine = editions.filter((edition) => edition.publicationId === title.id);
    // The one being worked on, or the newest there is. Same rule as the title's own page, so the
    // two screens never disagree about which edition is "the" edition.
    const live = mine.find((edition) => edition.status !== "PUBLISHED" && edition.status !== "ARCHIVED") ?? mine[0] ?? null;
    return {
      id: title.id,
      name: title.name,
      cadence: title.cadence,
      formats: title.defaultFormats,
      editions: mine.length,
      published: mine.filter((edition) => edition.status === "PUBLISHED" || edition.status === "ARCHIVED").length,
      live,
    };
  });
}

/**
 * One title, with its editions — the newsletter as a durable thing rather than a row in a list.
 *
 * A newsletter is set up once and then runs for years; an edition is the thing you make every
 * month. Reading them together is what lets a screen say "Edition #6 · October 2026, collecting
 * contributions" with one button beside it, which is the whole shape of the work.
 */
export async function publicationWithEditions(publicationId: string, organizationId: string) {
  const publication = await db.query.publications.findFirst({
    where: and(eq(s.publications.id, publicationId), eq(s.publications.organizationId, organizationId)),
  });
  if (!publication) return null;

  const editions = await db
    .select({
      id: s.editions.id,
      issueNumber: s.editions.issueNumber,
      label: s.editions.label,
      title: s.editions.title,
      status: s.editions.status,
      month: s.editions.month,
      year: s.editions.year,
      publicationTargetAt: s.editions.publicationTargetAt,
      publishedAt: s.editions.publishedAt,
      createdAt: s.editions.createdAt,
    })
    .from(s.editions)
    .where(and(eq(s.editions.publicationId, publicationId), eq(s.editions.organizationId, organizationId), isNull(s.editions.hiddenAt)))
    .orderBy(desc(s.editions.year), desc(s.editions.month), desc(s.editions.issueNumber));

  // The edition being worked on is the most recent one that has not gone out; failing that, the
  // most recent one there is. A title whose last edition published is between issues, and saying
  // so is more useful than showing the published one as though it were live.
  const live = editions.find((edition) => edition.status !== "PUBLISHED" && edition.status !== "ARCHIVED") ?? editions[0] ?? null;

  const [subscribers] = await db
    .select({ count: sql<number>`count(*)` })
    .from(s.publicationSubscriptions)
    .innerJoin(s.subscribers, eq(s.publicationSubscriptions.subscriberId, s.subscribers.id))
    .where(
      and(
        eq(s.publicationSubscriptions.publicationId, publicationId),
        eq(s.publicationSubscriptions.isActive, true),
        eq(s.subscribers.organizationId, organizationId),
        eq(s.subscribers.status, "SUBSCRIBED"),
      ),
    );

  // Every issue the title has, hidden ones included. The list above leaves hidden editions out —
  // rightly, nobody wants to read them — but deleting the title takes them too, so the screen that
  // asks must count what the deletion counts rather than what the table shows.
  const [all] = await db
    .select({ count: sql<number>`count(*)` })
    .from(s.editions)
    .where(and(eq(s.editions.publicationId, publicationId), eq(s.editions.organizationId, organizationId)));

  return {
    publication,
    editions,
    live,
    published: editions.filter((edition) => edition.status === "PUBLISHED" || edition.status === "ARCHIVED").length,
    editionCount: Number(all?.count ?? 0),
    subscribers: Number(subscribers?.count ?? 0),
  };
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
