import { LocalStorageAdapter } from "./local";
import { S3StorageAdapter } from "./s3";
import { storageConfig, type ResolvedStorage } from "./config";
import type { StorageAdapter } from "./types";

/**
 * The storage in use, resolved from the console and the environment.
 *
 * Asynchronous on purpose. It used to read the environment synchronously, which meant the bucket a
 * platform admin connected in the console did nothing at all until somebody also set six variables
 * on the host — a card that looked finished and changed nothing. Resolving properly means one
 * await, and it also keeps `localPath` honest: callers that branch on it are asking "is this on
 * disk", and answering that from a stale guess sends a reader a 404 for a file that exists.
 */

let cached: { fingerprint: string; adapter: StorageAdapter } | null = null;

function build(config: ResolvedStorage): StorageAdapter {
  return config.provider === "s3" ? new S3StorageAdapter(config) : new LocalStorageAdapter(config.localDir);
}

export async function getStorage(): Promise<StorageAdapter> {
  const config = await storageConfig();
  if (cached?.fingerprint === config.fingerprint) return cached.adapter;
  const adapter = build(config);
  cached = { fingerprint: config.fingerprint, adapter };
  return adapter;
}

/** Forget the client, so the next call builds one from the configuration just saved. */
export function resetStorage() {
  cached = null;
}

export { storageKeys, extensionForMime } from "./keys";
export { storageConfig, resetStorageConfig, normaliseEndpoint, DEFAULT_BUCKET } from "./config";
export type { StorageAdapter, PutOptions, SignedUrlOptions } from "./types";
