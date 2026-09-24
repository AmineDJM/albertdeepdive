import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";
import type { VariantKind } from "./urls";

/**
 * Picture addresses that last as long as the email they are in.
 *
 * An email is opened whenever the reader gets to it — next week, next year — and the storage
 * behind Briefly will not sign an address for that long: S3 refuses any signature past seven days,
 * and a year-long local signature is a key nobody can take back. So a sent email carries Briefly's
 * own address for each picture, `/api/public/image/<token>`. The token names one size of one
 * picture and is sealed with AUTH_SECRET, so it cannot be edited to reach another; each time it is
 * opened Briefly signs a fresh short-lived address and sends the reader there.
 *
 * Because the address is Briefly's, Briefly still decides: a picture that has been deleted, or
 * whose rights were withdrawn after the email went out, stops being served to anybody.
 */

const KINDS: readonly VariantKind[] = ["THUMBNAIL", "WEB", "PRINT"];

function seal(assetId: string, kind: VariantKind): string {
  return createHmac("sha256", env.AUTH_SECRET).update(`durable-image:${assetId}:${kind}`).digest("base64url").slice(0, 32);
}

export function durableImageToken(assetId: string, kind: VariantKind = "WEB"): string {
  return `${assetId}.${kind.toLowerCase()}.${seal(assetId, kind)}`;
}

/** The asset and size a token names, or null when it was not made here or has been altered. */
export function readDurableImageToken(token: string): { assetId: string; kind: VariantKind } | null {
  const [assetId, rawKind, signature] = token.split(".");
  const kind = rawKind?.toUpperCase() as VariantKind;
  if (!assetId || !signature || !KINDS.includes(kind)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return null;
  const expected = Buffer.from(seal(assetId, kind));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { assetId, kind };
}

export function durableImageUrl(assetId: string, kind: VariantKind = "WEB"): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/public/image/${durableImageToken(assetId, kind)}`;
}

/** Durable addresses for the pictures that exist, by id: an id with no picture gets no address. */
export async function durableImageUrls(assetIds: string[], kind: VariantKind = "WEB"): Promise<Record<string, string>> {
  const ids = [...new Set(assetIds.filter(Boolean))];
  if (!ids.length) return {};
  const rows = await db.select({ id: s.mediaAssets.id }).from(s.mediaAssets).where(inArray(s.mediaAssets.id, ids));
  return Object.fromEntries(rows.map((row) => [row.id, durableImageUrl(row.id, kind)]));
}

/**
 * The storage key to serve for a token, or null when the picture must not be shown any more:
 * it is gone, or its rights were refused.
 */
export async function durableImageKey(assetId: string, kind: VariantKind): Promise<string | null> {
  const asset = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, assetId), columns: { storageKey: true, rightsStatus: true } });
  if (!asset || asset.rightsStatus === "RED") return null;
  const variant = await db.query.mediaVariants.findFirst({ where: and(eq(s.mediaVariants.assetId, assetId), eq(s.mediaVariants.kind, kind)), columns: { storageKey: true } });
  return variant?.storageKey ?? asset.storageKey;
}
