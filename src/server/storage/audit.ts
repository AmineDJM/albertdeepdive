import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { createLogger } from "@/server/logger";
import { getStorage } from "./index";
import { storageConfig } from "./config";

const log = createLogger("storage:audit");

/**
 * Is the storage this install is configured for actually there, and is everything in it.
 *
 * Written because of a question nobody could answer: every thumbnail in a deployed library came
 * back broken, and the database, the code and the console each looked fine on their own. The
 * database holds a key; the browser asks for that key; whether the bytes behind it exist is a
 * third fact, and until now nothing in the product could state it.
 *
 * Two answers, kept apart on purpose. `storageHealth` says whether the *service* works, with a
 * real round trip rather than a credentials check — a bucket that accepts a write and refuses a
 * read is configured and broken, and only trying tells you. `auditStorage` says whether the
 * *contents* match the database, in both directions: rows whose bytes are gone (what a reader sees
 * as a broken picture) and bytes no row points at (what an invoice sees as storage nobody needs).
 */

export type StorageHealth = {
  provider: "local" | "s3";
  bucket: string | null;
  /** The endpoint host only — never the credentials. */
  endpointHost: string | null;
  configured: boolean;
  wrote: boolean;
  read: boolean;
  signed: boolean;
  deleted: boolean;
  ok: boolean;
  latencyMs: number;
  checkedAt: Date;
  error: string | null;
};

/** A key a health check may write. Its own prefix, so it is never mistaken for a customer's file. */
const HEALTH_KEY = () => `health/check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;

/**
 * Write a tiny object, read it back, sign it, delete it — and time the round trip.
 *
 * Each step is reported separately because they fail for different reasons and want different
 * answers: a write that fails is usually credentials or a missing bucket; a read that fails after a
 * successful write is usually a policy; a delete that fails leaves litter somebody should know
 * about. The object lives under `health/`, which `organizationOwning` does not recognise, so it is
 * not servable to anybody on the signed-in path.
 */
export async function storageHealth(): Promise<StorageHealth> {
  const config = await storageConfig();
  const started = Date.now();
  const result: StorageHealth = {
    provider: config.provider,
    bucket: config.provider === "s3" ? config.bucket || null : null,
    endpointHost: config.endpoint ? safeHost(config.endpoint) : null,
    configured: config.provider === "s3" ? Boolean(config.bucket && config.accessKeyId && config.secretAccessKey) : true,
    wrote: false,
    read: false,
    signed: false,
    deleted: false,
    ok: false,
    latencyMs: 0,
    checkedAt: new Date(),
    error: null,
  };

  const key = HEALTH_KEY();
  const body = Buffer.from(`briefly storage check ${result.checkedAt.toISOString()}\n`, "utf8");
  try {
    await (await getStorage()).put(key, body, { contentType: "text/plain", cacheControl: "no-store" });
    result.wrote = true;
    const back = await (await getStorage()).get(key);
    result.read = Boolean(back && back.equals(body));
    if (!result.read) throw new Error("the object was written but did not read back byte for byte");
    const url = await (await getStorage()).getSignedUrl(key, { expiresInSeconds: 60 });
    result.signed = Boolean(url);
    await (await getStorage()).delete(key);
    result.deleted = !(await (await getStorage()).exists(key));
    result.ok = result.wrote && result.read && result.signed && result.deleted;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    // Best effort: a failed check must not leave its own object behind.
    await (await getStorage())
      .delete(key)
      .catch(() => undefined);
  }
  result.latencyMs = Date.now() - started;
  return result;
}

/** The host of an endpoint, for a console that must never print the credentials beside it. */
function safeHost(endpoint: string): string | null {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

export type MissingObject = {
  kind: "original" | "variant" | "publication";
  key: string;
  assetId: string;
  organizationId: string | null;
  label: string;
};

export type StorageAudit = {
  provider: "local" | "s3";
  bucket: string | null;
  checkedAt: Date;
  /** Keys the database expects to exist. */
  expected: number;
  /** Keys present in storage under the prefixes the database uses. */
  present: number;
  missing: MissingObject[];
  /** Objects in storage that no row points at — safe to reclaim, listed rather than deleted. */
  orphans: string[];
  byWorkspace: { organizationId: string | null; name: string; missing: number }[];
  truncated: boolean;
};

const AUDIT_PREFIXES = ["media/", "publications/"] as const;

/**
 * Compare what the database says exists with what storage actually holds.
 *
 * One listing per prefix rather than an existence check per row: a library of ten thousand pictures
 * is thirty thousand keys once variants are counted, and thirty thousand HEAD requests is a
 * different kind of outage. The comparison is a set difference either way.
 *
 * Nothing is deleted and nothing is repaired here. An audit that also fixes things is an audit
 * nobody can run twice to see whether the fix worked.
 */
export async function auditStorage(options: { organizationId?: string; limit?: number } = {}): Promise<StorageAudit> {
  const limit = options.limit ?? 500;
  const config = await storageConfig();
  const storage = await getStorage();

  const assets = await db
    .select({ id: s.mediaAssets.id, key: s.mediaAssets.storageKey, organizationId: s.mediaAssets.organizationId, fileName: s.mediaAssets.fileName })
    .from(s.mediaAssets)
    .where(options.organizationId ? eq(s.mediaAssets.organizationId, options.organizationId) : undefined);
  const assetIds = assets.map((a) => a.id);
  const variants = assetIds.length
    ? await db
        .select({ assetId: s.mediaVariants.assetId, key: s.mediaVariants.storageKey, kind: s.mediaVariants.kind })
        .from(s.mediaVariants)
        .where(inArray(s.mediaVariants.assetId, assetIds))
    : [];
  const publications = await db
    .select({ id: s.publicationAssets.id, key: s.publicationAssets.storageKey, fileName: s.publicationAssets.fileName, organizationId: s.editions.organizationId })
    .from(s.publicationAssets)
    .innerJoin(s.editions, eq(s.editions.id, s.publicationAssets.editionId))
    .where(options.organizationId ? eq(s.editions.organizationId, options.organizationId) : undefined);

  const orgById = new Map(assets.map((a) => [a.id, a.organizationId]));
  const nameById = new Map((await db.select({ id: s.organizations.id, name: s.organizations.name }).from(s.organizations)).map((o) => [o.id, o.name]));

  const present = new Set<string>();
  for (const prefix of AUDIT_PREFIXES) {
    try {
      for (const key of await storage.list(prefix)) present.add(key);
    } catch (err) {
      log.warn("could not list a prefix", { prefix, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const expected: MissingObject[] = [
    ...assets.map((a) => ({ kind: "original" as const, key: a.key, assetId: a.id, organizationId: a.organizationId, label: a.fileName })),
    ...variants.map((v) => ({ kind: "variant" as const, key: v.key, assetId: v.assetId, organizationId: orgById.get(v.assetId) ?? null, label: String(v.kind).toLowerCase() })),
    ...publications.map((p) => ({ kind: "publication" as const, key: p.key, assetId: p.id, organizationId: p.organizationId, label: p.fileName })),
  ];

  const missing = expected.filter((row) => !present.has(row.key));
  const wanted = new Set(expected.map((row) => row.key));
  const orphans = [...present].filter((key) => !wanted.has(key));

  const byWorkspace = new Map<string | null, number>();
  for (const row of missing) byWorkspace.set(row.organizationId, (byWorkspace.get(row.organizationId) ?? 0) + 1);

  return {
    provider: config.provider,
    bucket: config.provider === "s3" ? config.bucket || null : null,
    checkedAt: new Date(),
    expected: expected.length,
    present: present.size,
    missing: missing.slice(0, limit),
    orphans: orphans.slice(0, limit),
    byWorkspace: [...byWorkspace.entries()]
      .map(([organizationId, count]) => ({ organizationId, name: (organizationId && nameById.get(organizationId)) || "Unclaimed", missing: count }))
      .sort((a, b) => b.missing - a.missing),
    truncated: missing.length > limit || orphans.length > limit,
  };
}

export type ChecksumResult = { assetId: string; key: string; expected: string; actual: string | null; ok: boolean };

/**
 * Prove a sample of originals are byte-for-byte what was ingested.
 *
 * A present object is not necessarily the right object: a truncated upload, a half-finished
 * migration or a key reused by mistake all leave a file where one is expected. `sha256` was
 * recorded at ingest, so this is a comparison rather than an opinion. Sampled by default because
 * it downloads every byte it checks.
 */
export async function verifyChecksums(sample = 25, organizationId?: string): Promise<ChecksumResult[]> {
  const storage = await getStorage();
  const rows = await db
    .select({ id: s.mediaAssets.id, key: s.mediaAssets.storageKey, sha256: s.mediaAssets.sha256 })
    .from(s.mediaAssets)
    .where(organizationId ? eq(s.mediaAssets.organizationId, organizationId) : undefined)
    .limit(sample);
  const out: ChecksumResult[] = [];
  for (const row of rows) {
    if (!row.sha256) continue;
    const bytes = await storage.get(row.key).catch(() => null);
    const actual = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
    out.push({ assetId: row.id, key: row.key, expected: row.sha256, actual, ok: actual === row.sha256 });
  }
  return out;
}
