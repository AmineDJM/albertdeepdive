import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { modelByKey } from "@/lib/images/capabilities";
import type { ImageQa, ReferenceRole, Sensitivity } from "@/lib/images/types";
import { imageEngineConfig } from "./providers";
import { lineage, type ImageVersionRow } from "./service";

/**
 * What a screen is told about a picture's versions.
 *
 * Signed URLs, never storage keys; plain statuses; and the routing — which model, why, what it
 * cost — only when the console allows it or the person is platform staff. A customer sees "Ready",
 * "Being made" and a picture. The engine's vocabulary stays with the engine.
 */

const TTL = 3600;

export type ImageVersionView = {
  id: string;
  rootId: string;
  parentId: string | null;
  version: number;
  label: string;
  instruction: string;
  operation: string;
  status: ImageVersionRow["status"];
  sensitivity: Sensitivity;
  isCurrent: boolean;
  accepted: boolean | null;
  mediaId: string | null;
  previewUrl: string | null;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  qa: Pick<ImageQa, "score" | "verdict" | "issues" | "method"> | null;
  change: string[];
  preserve: string[];
  references: { role: ReferenceRole; mediaId: string }[];
  error: string | null;
  createdAt: string;
  /** Present only when routing may be shown. */
  routing: { provider: string; model: string; modelLabel: string | null; candidates: string[]; reasons: Record<string, string>; attempts: { provider: string; model: string; latencyMs: number; error: string | null; qaScore: number | null }[]; retries: number; latencyMs: number | null; costCents: number; prompt: string | null; mask: boolean; variations: number | null } | null;
};

export type ImageLineView = { rootId: string; versions: ImageVersionView[]; current: ImageVersionView | null; busy: boolean };

async function urlsFor(mediaIds: string[]): Promise<Map<string, { previewUrl: string; thumbUrl: string; width: number | null; height: number | null }>> {
  const out = new Map<string, { previewUrl: string; thumbUrl: string; width: number | null; height: number | null }>();
  if (!mediaIds.length) return out;
  const storage = getStorage();
  const [assets, variants] = await Promise.all([
    db.query.mediaAssets.findMany({ where: inArray(s.mediaAssets.id, mediaIds), columns: { id: true, storageKey: true, width: true, height: true } }),
    db.query.mediaVariants.findMany({ where: and(inArray(s.mediaVariants.assetId, mediaIds), inArray(s.mediaVariants.kind, ["THUMBNAIL", "WEB"])), columns: { assetId: true, kind: true, storageKey: true } }),
  ]);
  for (const asset of assets) {
    const web = variants.find((variant) => variant.assetId === asset.id && variant.kind === "WEB")?.storageKey ?? asset.storageKey;
    const thumb = variants.find((variant) => variant.assetId === asset.id && variant.kind === "THUMBNAIL")?.storageKey ?? web;
    out.set(asset.id, { previewUrl: await storage.getSignedUrl(web, { expiresInSeconds: TTL }), thumbUrl: await storage.getSignedUrl(thumb, { expiresInSeconds: TTL }), width: asset.width, height: asset.height });
  }
  return out;
}

export async function versionViews(rows: ImageVersionRow[], options: { showRouting: boolean }): Promise<ImageVersionView[]> {
  const urls = await urlsFor(rows.map((row) => row.mediaId).filter((id): id is string => Boolean(id)));
  const config = options.showRouting ? await imageEngineConfig() : null;
  return rows.map((row) => {
    const media = row.mediaId ? urls.get(row.mediaId) : null;
    const debug = row.debug as { modelKey?: string; candidates?: string[]; reasons?: Record<string, string>; prompt?: string; mask?: boolean; variations?: number };
    return {
      id: row.id,
      rootId: row.rootId ?? row.id,
      parentId: row.parentId,
      version: row.version,
      label: row.label,
      instruction: row.instruction,
      operation: row.operation,
      status: row.status,
      sensitivity: row.sensitivity,
      isCurrent: row.isCurrent,
      accepted: row.accepted,
      mediaId: row.mediaId,
      previewUrl: media?.previewUrl ?? null,
      thumbUrl: media?.thumbUrl ?? null,
      width: media?.width ?? null,
      height: media?.height ?? null,
      qa: row.qa ? { score: row.qa.score, verdict: row.qa.verdict, issues: row.qa.issues, method: row.qa.method } : null,
      change: row.plan?.change ?? [],
      preserve: row.plan?.preserve ?? [],
      references: row.references,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      routing:
        options.showRouting && (row.provider || row.attempts.length)
          ? {
              provider: row.provider ?? "",
              model: row.model ?? "",
              modelLabel: debug.modelKey ? (modelByKey(debug.modelKey, config?.registry)?.label ?? null) : null,
              candidates: debug.candidates ?? [],
              reasons: debug.reasons ?? {},
              attempts: row.attempts.map((attempt) => ({ provider: attempt.provider, model: attempt.model, latencyMs: attempt.latencyMs, error: attempt.error, qaScore: attempt.qaScore })),
              retries: row.retries,
              latencyMs: row.latencyMs,
              costCents: Number(row.costCents),
              prompt: debug.prompt ?? null,
              mask: Boolean(debug.mask),
              variations: debug.variations ?? null,
            }
          : null,
    };
  });
}

/** The line a library picture belongs to — empty when it was never generated or edited. */
export async function lineViewForMedia(mediaId: string, options: { showRouting: boolean }): Promise<ImageLineView | null> {
  const version = await db.query.imageVersions.findFirst({ where: eq(s.imageVersions.mediaId, mediaId), orderBy: [desc(s.imageVersions.createdAt)] });
  if (!version) return null;
  const rootId = version.rootId ?? version.id;
  const versions = await versionViews(await lineage(rootId), options);
  return { rootId, versions, current: versions.find((view) => view.isCurrent) ?? null, busy: versions.some((view) => view.status === "QUEUED" || view.status === "RUNNING") };
}

/** Pictures asked for on this edition (or in the library) that are being made or did not come out. */
export async function pendingViews(organizationId: string, editionId: string | null, options: { showRouting: boolean }): Promise<ImageVersionView[]> {
  const rows = await db.query.imageVersions.findMany({
    where: and(eq(s.imageVersions.organizationId, organizationId), editionId ? eq(s.imageVersions.editionId, editionId) : isNull(s.imageVersions.editionId), or(inArray(s.imageVersions.status, ["QUEUED", "RUNNING", "FAILED"]), and(eq(s.imageVersions.status, "READY"), eq(s.imageVersions.operation, "generate"), eq(s.imageVersions.version, 1)))),
    orderBy: [desc(s.imageVersions.createdAt)],
    limit: 12,
  });
  return versionViews(rows, options);
}

export type ReferenceCandidate = { id: string; label: string; thumbUrl: string | null; kind: string; rightsStatus: string };

/** Pictures a person may point at as references: their own, cleared or unclear, never blocked ones. */
export async function referenceCandidates(organizationId: string, editionId: string | null, exclude: string[] = []): Promise<ReferenceCandidate[]> {
  const rows = await db.query.mediaAssets.findMany({
    where: and(eq(s.mediaAssets.organizationId, organizationId), eq(s.mediaAssets.isArchived, false), inArray(s.mediaAssets.rightsStatus, ["GREEN", "YELLOW"]), editionId ? or(eq(s.mediaAssets.editionId, editionId), isNull(s.mediaAssets.editionId)) : undefined),
    orderBy: [desc(s.mediaAssets.createdAt)],
    limit: 40,
  });
  const kept = rows.filter((row) => !exclude.includes(row.id)).slice(0, 24);
  const urls = await urlsFor(kept.map((row) => row.id));
  return kept.map((row) => ({ id: row.id, label: row.caption || row.fileName, thumbUrl: urls.get(row.id)?.thumbUrl ?? null, kind: row.kind, rightsStatus: row.rightsStatus }));
}

/** Whether this person may see which model made a picture. */
export async function mayShowRouting(user: { role: string } | null): Promise<boolean> {
  if (user?.role === "SUPER_ADMIN") return true;
  return (await imageEngineConfig()).showRouting;
}
