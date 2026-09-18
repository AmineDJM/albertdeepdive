import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES } from "@/server/jobs/registry";
import { kickJobRunner } from "@/server/jobs/runner";
import { assertCredits } from "@/server/creative/service";
import { guardTenant } from "@/server/tenancy/scope";
import { NotFoundError, ValidationError } from "@/lib/action-result";
import { REFERENCE_ROLES } from "@/lib/images/types";
import type { ModelStats } from "@/lib/images/router";

const log = createLogger("images");

export type ImageVersionRow = typeof s.imageVersions.$inferSelect;

/**
 * Pictures, asked for and kept.
 *
 * Asking is cheap and immediate: a row in the line, a job in the queue. Making is the job's work.
 * Every version is immutable once made; "undo" is pointing the line's current marker at an
 * earlier one, "branch" is asking for an edit of any version rather than the latest, and nothing a
 * person did is ever lost — not the original, not the one they liked less.
 */

export const SIZES = { square: { width: 1024, height: 1024 }, landscape: { width: 1536, height: 1024 }, portrait: { width: 1024, height: 1536 }, story: { width: 1080, height: 1920 } } as const;
export type SizeKey = keyof typeof SIZES;

export const advancedSchema = z.object({
  latitude: z.number().min(-1).max(1).default(0),
  variations: z.number().int().min(1).max(4).nullable().default(null),
  realism: z.number().min(0).max(1).nullable().default(null),
});
export type AdvancedInput = z.input<typeof advancedSchema>;

export const referenceSchema = z.object({ role: z.enum(REFERENCE_ROLES), mediaId: z.string().uuid() });

export const requestImageSchema = z.object({
  instruction: z.string().trim().min(3).max(1200),
  references: z.array(referenceSchema).max(6).default([]),
  advanced: advancedSchema.default({ latitude: 0, variations: null, realism: null }),
  size: z.enum(["square", "landscape", "portrait", "story"]).default("landscape"),
});

export const requestEditSchema = z.object({
  instruction: z.string().trim().min(3).max(1200),
  references: z.array(referenceSchema).max(6).default([]),
  advanced: advancedSchema.default({ latitude: 0, variations: null, realism: null }),
});

function label(instruction: string): string {
  const words = instruction.trim().replace(/\s+/g, " ").split(" ");
  const short = words.slice(0, 7).join(" ");
  return (words.length > 7 ? `${short}…` : short).replace(/^./, (letter) => letter.toUpperCase());
}

async function ownAssets(organizationId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db.query.mediaAssets.findMany({ where: inArray(s.mediaAssets.id, ids) });
  const foreign = rows.find((row) => row.organizationId !== organizationId);
  if (foreign || rows.length !== ids.length) throw new NotFoundError("Reference picture");
  return rows;
}

/** Ask for a new picture. The row is the request; the job makes it. */
export async function requestImage(input: z.input<typeof requestImageSchema> & { organizationId: string; editionId?: string | null; actorId?: string | null }): Promise<ImageVersionRow> {
  const parsed = requestImageSchema.parse(input);
  await ownAssets(input.organizationId, parsed.references.map((reference) => reference.mediaId));
  await assertCredits(input.organizationId, parsed.advanced.variations ?? 1);
  const [row] = await db
    .insert(s.imageVersions)
    .values({
      organizationId: input.organizationId,
      editionId: input.editionId ?? null,
      version: 1,
      label: label(parsed.instruction),
      operation: "generate",
      instruction: parsed.instruction,
      references: parsed.references,
      status: "QUEUED",
      debug: { request: { size: parsed.size, advanced: parsed.advanced } },
      createdById: input.actorId ?? null,
    })
    .returning();
  await audit({ action: "image.request", organizationId: input.organizationId, userId: input.actorId ?? null, editionId: input.editionId ?? null, metadata: { versionId: row.id, operation: "generate" } });
  await enqueueImage(row, input.actorId ?? null);
  return row;
}

/** The line a library picture belongs to, or a root made for it so an edit has a v1 to start from. */
export async function rootForAsset(asset: typeof s.mediaAssets.$inferSelect, actorId?: string | null): Promise<ImageVersionRow> {
  const existing = await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.mediaId, asset.id), orderBy: [desc(s.imageVersions.createdAt)] });
  if (existing) return existing;
  if (!asset.organizationId) throw new ValidationError("This picture belongs to no workspace.");
  const [row] = await db
    .insert(s.imageVersions)
    .values({ organizationId: asset.organizationId, editionId: asset.editionId, version: 1, label: "Original", mediaId: asset.id, operation: "import", instruction: asset.caption || asset.fileName, status: "READY", isCurrent: true, accepted: true, createdById: actorId ?? null })
    .returning();
  return row;
}

/** Ask for a change to a picture: to the latest version of its line, or to any earlier one (a branch). */
export async function requestEdit(input: z.input<typeof requestEditSchema> & { organizationId: string; mediaId?: string | null; versionId?: string | null; actorId?: string | null }): Promise<ImageVersionRow> {
  const parsed = requestEditSchema.parse(input);
  let base: ImageVersionRow | null = null;
  if (input.versionId) {
    base = (await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, input.versionId) })) ?? null;
    if (!base || base.organizationId !== input.organizationId) throw new NotFoundError("Version");
  } else if (input.mediaId) {
    const [asset] = await ownAssets(input.organizationId, [input.mediaId]);
    base = await rootForAsset(asset, input.actorId);
  }
  if (!base) throw new ValidationError("Choose a picture to edit.");
  if (base.status !== "READY" || !base.mediaId) throw new ValidationError("That version has no picture to edit yet.");
  await ownAssets(input.organizationId, parsed.references.map((reference) => reference.mediaId));
  await assertCredits(input.organizationId, parsed.advanced.variations ?? 1);

  const rootId = base.rootId ?? base.id;
  const [latest] = await db.select({ version: sql<number>`coalesce(max(${s.imageVersions.version}), 1)` }).from(s.imageVersions).where(or(eq(s.imageVersions.rootId, rootId), eq(s.imageVersions.id, rootId)));
  const [row] = await db
    .insert(s.imageVersions)
    .values({
      organizationId: input.organizationId,
      editionId: base.editionId,
      rootId,
      parentId: base.id,
      version: Number(latest.version) + 1,
      label: label(parsed.instruction),
      operation: "edit",
      instruction: parsed.instruction,
      references: parsed.references,
      status: "QUEUED",
      debug: { request: { advanced: parsed.advanced } },
      createdById: input.actorId ?? null,
    })
    .returning();
  await audit({ action: "image.request", organizationId: input.organizationId, userId: input.actorId ?? null, editionId: base.editionId, metadata: { versionId: row.id, operation: "edit", parent: base.id, version: row.version } });
  await enqueueImage(row, input.actorId ?? null);
  return row;
}

export async function enqueueImage(row: Pick<ImageVersionRow, "id" | "editionId">, actorId: string | null) {
  const job = await enqueueJob({ type: JOB_TYPES.IMAGE_RENDER, payload: { versionId: row.id }, idempotencyKey: `image:${row.id}`, editionId: row.editionId ?? null, createdById: actorId, priority: 4, maxAttempts: 2 });
  kickJobRunner();
  return job;
}

export async function getVersion(versionId: string): Promise<ImageVersionRow> {
  const row = await guardTenant(await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.id, versionId) }), "Version");
  if (!row) throw new NotFoundError("Version");
  return row;
}

/** Every version of a line, oldest first. */
export async function lineage(rootId: string): Promise<ImageVersionRow[]> {
  return db.query.imageVersions.findMany({ where: or(eq(s.imageVersions.id, rootId), eq(s.imageVersions.rootId, rootId)), orderBy: [asc(s.imageVersions.version), asc(s.imageVersions.createdAt)] });
}

/** The line a library picture is part of, if it is part of one. */
export async function lineageForMedia(mediaId: string): Promise<ImageVersionRow[]> {
  const version = await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.mediaId, mediaId), orderBy: [desc(s.imageVersions.createdAt)] });
  if (!version) return [];
  return lineage(version.rootId ?? version.id);
}

/** Point the line at this version: what "restore" and "use this one" both mean. */
export async function setCurrentVersion(versionId: string, actorId?: string | null): Promise<ImageVersionRow> {
  const version = await getVersion(versionId);
  if (version.status !== "READY") throw new ValidationError("Only a finished version can be the current one.");
  const rootId = version.rootId ?? version.id;
  await db.update(s.imageVersions).set({ isCurrent: false, updatedAt: new Date() }).where(or(eq(s.imageVersions.id, rootId), eq(s.imageVersions.rootId, rootId)));
  const [row] = await db.update(s.imageVersions).set({ isCurrent: true, accepted: true, updatedAt: new Date() }).where(eq(s.imageVersions.id, version.id)).returning();
  await audit({ action: "image.version.current", organizationId: version.organizationId, userId: actorId ?? null, editionId: version.editionId, metadata: { versionId: version.id, version: version.version } });
  return row;
}

/** Throw a version out: it stays in the line's history, greyed, and its file leaves the library's lists. */
export async function rejectVersion(versionId: string, actorId?: string | null): Promise<ImageVersionRow> {
  const version = await getVersion(versionId);
  if (version.operation === "import") throw new ValidationError("The original cannot be thrown out from here.");
  const [row] = await db.update(s.imageVersions).set({ accepted: false, isCurrent: false, status: "REJECTED", updatedAt: new Date() }).where(eq(s.imageVersions.id, version.id)).returning();
  if (version.mediaId) await db.update(s.mediaAssets).set({ isArchived: true, updatedAt: new Date() }).where(eq(s.mediaAssets.id, version.mediaId));
  if (version.isCurrent && version.parentId) await setCurrentVersion(version.parentId, actorId);
  await audit({ action: "image.version.reject", organizationId: version.organizationId, userId: actorId ?? null, editionId: version.editionId, metadata: { versionId: version.id, version: version.version } });
  return row;
}

/** How each model has done here, for the router's tie-breaks. */
export async function modelStats(organizationId?: string | null): Promise<ModelStats> {
  const rows = await db.query.imageVersions.findMany({
    where: and(inArray(s.imageVersions.status, ["READY", "FAILED", "REJECTED"]), organizationId ? eq(s.imageVersions.organizationId, organizationId) : undefined),
    columns: { attempts: true, provider: true, model: true, status: true, qa: true, debug: true },
    orderBy: [desc(s.imageVersions.createdAt)],
    limit: 500,
  });
  const stats: ModelStats = {};
  const bump = (key: string, ok: boolean, qa: number | null) => {
    const entry = (stats[key] ??= { attempts: 0, succeeded: 0, averageQa: null });
    entry.attempts += 1;
    if (ok) entry.succeeded += 1;
    if (qa !== null) entry.averageQa = entry.averageQa === null ? qa : Math.round(((entry.averageQa * (entry.attempts - 1) + qa) / entry.attempts) * 100) / 100;
  };
  for (const row of rows) {
    const winner = (row.debug as { modelKey?: string }).modelKey ?? null;
    for (const attempt of row.attempts) {
      const key = (attempt as { modelKey?: string }).modelKey ?? attempt.model;
      bump(key, attempt.error === null && (attempt.qaScore ?? 0) >= 0.7, attempt.qaScore);
    }
    if (winner && !row.attempts.length) bump(winner, row.status === "READY", row.qa?.score ?? null);
  }
  return stats;
}

/** Versions still being made, for the screens that poll. */
export async function pendingVersions(organizationId: string, editionId?: string | null): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(s.imageVersions)
    .where(and(eq(s.imageVersions.organizationId, organizationId), inArray(s.imageVersions.status, ["QUEUED", "RUNNING"]), editionId ? eq(s.imageVersions.editionId, editionId) : isNull(s.imageVersions.editionId)));
  return Number(row.n);
}

export function isUuid(value: string | null | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export { log as imageLog };
