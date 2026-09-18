import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getStorage } from "@/server/storage";

export type VariantKind = "THUMBNAIL" | "WEB" | "PRINT";

/** Signed URL for an asset variant (falls back to the original file). */
export async function mediaUrl(
  assetId: string,
  kind: VariantKind = "WEB",
  ttlSeconds = 3600,
): Promise<string | null> {
  const variant = await db.query.mediaVariants.findFirst({
    where: and(eq(s.mediaVariants.assetId, assetId), eq(s.mediaVariants.kind, kind)),
  });
  const key =
    variant?.storageKey ??
    (await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, assetId) }))?.storageKey;
  if (!key) return null;
  return (await getStorage()).getSignedUrl(key, { expiresInSeconds: ttlSeconds });
}

/** Signed URLs for many assets at once: { assetId: url }. */
export async function mediaUrls(
  assetIds: string[],
  kind: VariantKind = "THUMBNAIL",
  ttlSeconds = 3600,
): Promise<Record<string, string>> {
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (!ids.length) return {};
  const variants = await db.query.mediaVariants.findMany({
    where: and(inArray(s.mediaVariants.assetId, ids), eq(s.mediaVariants.kind, kind)),
  });
  const storage = await getStorage();
  const out: Record<string, string> = {};
  for (const v of variants)
    out[v.assetId] = await storage.getSignedUrl(v.storageKey, { expiresInSeconds: ttlSeconds });
  const missing = ids.filter((id) => !out[id]);
  if (missing.length) {
    const originals = await db.query.mediaAssets.findMany({
      where: inArray(s.mediaAssets.id, missing),
    });
    for (const o of originals)
      out[o.id] = await storage.getSignedUrl(o.storageKey, { expiresInSeconds: ttlSeconds });
  }
  return out;
}
