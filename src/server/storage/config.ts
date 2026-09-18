import { env } from "@/server/env";

/**
 * Where files go, decided once and read everywhere.
 *
 * The console is the place a platform admin connects a bucket, so the console wins: a saved bucket
 * with saved credentials means object storage, whatever `STORAGE_PROVIDER` says. The environment
 * remains the answer for an install that injects its secrets at deploy time, and the local disk
 * remains the answer when nothing is connected at all — which is right for a laptop and wrong for
 * every host that wipes its disk on redeploy, so the console says so on the card.
 */

export type ResolvedStorage = {
  provider: "local" | "s3";
  localDir: string;
  bucket: string;
  region: string;
  endpoint: string | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  publicBaseUrl: string | null;
  /** Changes whenever anything above does, so a cached client is rebuilt rather than reused. */
  fingerprint: string;
};

/** The bucket Briefly makes for itself when nobody names one. */
export const DEFAULT_BUCKET = "briefly-media";

/**
 * What a person pastes, turned into an endpoint the S3 client can use.
 *
 * Supabase shows a project URL in one place and an S3 endpoint in another, and both get pasted
 * into the same field by people who are right to think they are the same thing. They are, one
 * path apart, so this adds the path rather than refusing. Anything that is not Supabase is left
 * exactly as it was typed: R2, Scaleway and MinIO each have their own shape and none of them is
 * ours to rewrite.
 */
export function normaliseEndpoint(input: string | null | undefined): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return raw;
  }
  const isSupabase = /(^|\.)supabase\.(co|in|net)$/i.test(url.hostname);
  if (isSupabase && !/\/storage\/v1\/s3\/?$/.test(url.pathname)) {
    url.pathname = "/storage/v1/s3";
  }
  return url.toString().replace(/\/+$/, "");
}

/** Supabase names the region on the same page as the keys; this is the fallback when it is not given. */
export const FALLBACK_REGION = "us-east-1";

export function resolve(values: Record<string, string | null>): ResolvedStorage {
  const endpoint = normaliseEndpoint(values.endpoint);
  const accessKeyId = values.accessKeyId?.trim() || null;
  const secretAccessKey = values.secretAccessKey?.trim() || null;
  const bucket = values.bucket?.trim() || (endpoint && accessKeyId && secretAccessKey ? DEFAULT_BUCKET : "");
  // Credentials and somewhere to put them is the whole test. A half-filled card stays on disk
  // rather than failing on the first upload, which is the failure nobody notices until later.
  const connected = Boolean(bucket && accessKeyId && secretAccessKey);
  const provider: "local" | "s3" = connected ? "s3" : env.STORAGE_PROVIDER === "s3" ? "s3" : "local";
  const region = values.region?.trim() || (env.STORAGE_S3_REGION !== "auto" ? env.STORAGE_S3_REGION : "") || FALLBACK_REGION;
  const publicBaseUrl = values.publicBaseUrl?.trim() || null;
  return {
    provider,
    localDir: env.STORAGE_LOCAL_DIR,
    bucket: bucket || env.STORAGE_S3_BUCKET || "",
    region,
    endpoint,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl,
    fingerprint: [provider, bucket, region, endpoint, accessKeyId, publicBaseUrl, env.STORAGE_LOCAL_DIR].join("|"),
  };
}

let snapshot: { at: number; value: ResolvedStorage } | null = null;
const TTL_MS = 30_000;

/** Drop the snapshot: called whenever the console saves or clears the storage card. */
export function resetStorageConfig() {
  snapshot = null;
}

export async function storageConfig(): Promise<ResolvedStorage> {
  if (snapshot && Date.now() - snapshot.at < TTL_MS) return snapshot.value;
  let values: Record<string, string | null> = {};
  try {
    const { integrationConfig } = await import("@/server/integrations/service");
    values = await integrationConfig("storage");
  } catch {
    // No database yet (a build, a script, a test that never seeded): the environment still answers.
    values = {};
  }
  const value = resolve(values);
  snapshot = { at: Date.now(), value };
  return value;
}
