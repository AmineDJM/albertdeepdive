import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { createLogger } from "@/server/logger";
import { LocalStorageAdapter } from "./local";
import { S3StorageAdapter } from "./s3";
import { storageConfig } from "./config";
import type { StorageAdapter } from "./types";

const log = createLogger("storage:migrate");

/**
 * Move what is on the local disk into the connected bucket, without touching the database.
 *
 * The keys do not change. That is the whole reason this is a copy and not a migration in the
 * database sense: `media/<asset>/original.jpg` names the object under any provider, so a row that
 * pointed at a file on a Render disk points at the same object in Supabase the moment the bytes
 * are there. Nothing to rewrite, nothing to roll back, and no window where a published URL is
 * wrong.
 *
 * Every copy is verified before the source is considered migrated — size and, for anything the
 * library recorded a digest for, the digest. A file that copies to zero bytes is a file that would
 * render as a broken picture later, which is the failure this whole exercise is about.
 *
 * Nothing is deleted. Reclaiming the disk is a separate decision, taken by somebody who has seen
 * this report and the bucket.
 */

export type MigrationRow = {
  key: string;
  bytes: number;
  status: "copied" | "already-there" | "missing-locally" | "mismatch" | "failed";
  detail?: string;
};

export type MigrationReport = {
  from: "local";
  to: "s3";
  bucket: string;
  dryRun: boolean;
  considered: number;
  copied: number;
  alreadyThere: number;
  missingLocally: number;
  failed: number;
  rows: MigrationRow[];
};

/** Every key the database expects to exist, with the digest recorded for it where there is one. */
async function expectedKeys(organizationId?: string): Promise<{ key: string; sha256: string | null }[]> {
  const assets = await db
    .select({ id: s.mediaAssets.id, key: s.mediaAssets.storageKey, sha256: s.mediaAssets.sha256 })
    .from(s.mediaAssets)
    .where(organizationId ? eq(s.mediaAssets.organizationId, organizationId) : undefined);
  const variants = assets.length
    ? await db
        .select({ key: s.mediaVariants.storageKey })
        .from(s.mediaVariants)
        .where(inArray(s.mediaVariants.assetId, assets.map((a) => a.id)))
    : [];
  const publications = await db
    .select({ key: s.publicationAssets.storageKey, checksum: s.publicationAssets.checksum })
    .from(s.publicationAssets)
    .innerJoin(s.editions, eq(s.editions.id, s.publicationAssets.editionId))
    .where(organizationId ? eq(s.editions.organizationId, organizationId) : undefined);

  return [
    ...assets.map((a) => ({ key: a.key, sha256: a.sha256 })),
    // A variant is derived, so nothing recorded its digest; size is the check that is available.
    ...variants.map((v) => ({ key: v.key, sha256: null })),
    ...publications.map((p) => ({ key: p.key, sha256: p.checksum ?? null })),
  ];
}

const mimeForKey = (key: string): string => {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
    avif: "image/avif", svg: "image/svg+xml", tif: "image/tiff", heic: "image/heic",
    pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
    txt: "text/plain", json: "application/json",
  };
  return map[ext] ?? "application/octet-stream";
};

/**
 * Copy the local objects into the configured bucket.
 *
 * Refuses unless object storage is actually connected, because the alternative is a "migration"
 * that copies a disk onto itself and reports success. `dryRun` answers the only question worth
 * asking first: how much is there, and how much of it is already gone.
 */
export async function migrateLocalObjectsToBucket(options: { dryRun?: boolean; organizationId?: string; limit?: number } = {}): Promise<MigrationReport> {
  const config = await storageConfig();
  if (config.provider !== "s3") {
    throw new Error("Object storage is not connected: nothing to migrate into. Connect a bucket in Admin → Providers → Object storage first.");
  }
  const dryRun = options.dryRun ?? false;
  const local: StorageAdapter = new LocalStorageAdapter(config.localDir);
  const remote: StorageAdapter = new S3StorageAdapter(config);

  const keys = await expectedKeys(options.organizationId);
  const considered = options.limit ? keys.slice(0, options.limit) : keys;
  const rows: MigrationRow[] = [];

  for (const { key, sha256 } of considered) {
    try {
      if (await remote.exists(key)) {
        rows.push({ key, bytes: 0, status: "already-there" });
        continue;
      }
      const bytes = await local.get(key);
      if (!bytes) {
        // The row expects bytes that are on neither side. Reported, never invented.
        rows.push({ key, bytes: 0, status: "missing-locally" });
        continue;
      }
      if (sha256) {
        const digest = createHash("sha256").update(bytes).digest("hex");
        if (digest !== sha256) {
          rows.push({ key, bytes: bytes.length, status: "mismatch", detail: "the file on disk is not the one that was ingested" });
          continue;
        }
      }
      if (dryRun) {
        rows.push({ key, bytes: bytes.length, status: "copied", detail: "dry run" });
        continue;
      }
      await remote.put(key, bytes, { contentType: mimeForKey(key) });
      const back = await remote.get(key);
      if (!back || back.length !== bytes.length) {
        rows.push({ key, bytes: bytes.length, status: "failed", detail: `read back ${back?.length ?? 0} of ${bytes.length} bytes` });
        continue;
      }
      rows.push({ key, bytes: bytes.length, status: "copied" });
    } catch (err) {
      rows.push({ key, bytes: 0, status: "failed", detail: err instanceof Error ? err.message : String(err) });
    }
  }

  const count = (status: MigrationRow["status"]) => rows.filter((row) => row.status === status).length;
  const report: MigrationReport = {
    from: "local",
    to: "s3",
    bucket: config.bucket,
    dryRun,
    considered: considered.length,
    copied: count("copied"),
    alreadyThere: count("already-there"),
    missingLocally: count("missing-locally"),
    failed: count("failed") + count("mismatch"),
    rows,
  };
  log.info("storage migration", { ...report, rows: undefined });
  return report;
}
