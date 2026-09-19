import { env } from "@/server/env";
import type { PutOptions, SignedUrlOptions, StorageAdapter } from "./types";

/**
 * Durable customer files fail closed rather than landing somewhere they will not survive.
 *
 * The failure this prevents is the one that already happened: a deployment where object storage
 * was not connected wrote every photograph to a container's own filesystem, reported success, and
 * lost the lot on the next release. Nothing was broken at the time — every upload returned 200 —
 * so the defect only appeared later, as a library of broken pictures, with no way to tell when the
 * bytes had gone or which release took them.
 *
 * So in production, a write of a durable key to the local disk raises. Loudly, at the moment of the
 * upload, naming what to do about it. An upload that fails is a problem somebody fixes in ten
 * minutes; an upload that silently succeeds into a temporary filesystem is a problem discovered in
 * a month by a customer.
 *
 * Three things are deliberately *not* guarded:
 *
 *   - Reads, lists and deletes. Files already on a disk must stay readable, or turning the guard on
 *     would break a working install rather than protect the next one.
 *   - Scratch keys. `tmp/` is by definition transient and `health/` is the storage check itself,
 *     which must be able to run precisely when the guard would otherwise refuse.
 *   - Development and test, where the local disk is the right answer and a bucket is a nuisance.
 *
 * `STORAGE_ALLOW_LOCAL_DURABLE` opts out for an install that genuinely runs on a persistent volume
 * it trusts — and for the end-to-end suite, which runs a production build against a scratch
 * directory on purpose.
 */

const SCRATCH_PREFIXES = ["tmp/", "health/"] as const;

/** Keys that are allowed to live on a disk that may vanish, because losing them costs nothing. */
export function isScratchKey(key: string): boolean {
  return SCRATCH_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Whether a local-disk write of a durable key should be refused in this environment. */
export function failsClosed(provider: "local" | "s3"): boolean {
  if (provider !== "local") return false;
  if (env.NODE_ENV !== "production") return false;
  return !env.STORAGE_ALLOW_LOCAL_DURABLE;
}

export class DurableStorageUnavailableError extends Error {
  readonly code = "STORAGE_NOT_DURABLE";
  constructor(key: string) {
    super(
      `Refusing to store "${key}" on this machine's disk. Durable customer files need object storage, ` +
        `which is not connected: a container replacement would take them and nothing would say so. ` +
        `Connect a bucket in Admin → Providers → Object storage, check it under Admin → Storage, and ` +
        `copy what is already on disk into it from the same screen.`,
    );
    this.name = "DurableStorageUnavailableError";
  }
}

/**
 * A local adapter that refuses to accept anything durable.
 *
 * Everything but `put` is passed straight through, so the app keeps reading and serving what it
 * already has while it is impossible to add to it.
 */
export class FailClosedLocalAdapter implements StorageAdapter {
  readonly name = "local" as const;

  constructor(private readonly inner: StorageAdapter) {}

  async put(key: string, body: Buffer | Uint8Array, options: PutOptions) {
    if (!isScratchKey(key)) throw new DurableStorageUnavailableError(key);
    return this.inner.put(key, body, options);
  }

  get(key: string) {
    return this.inner.get(key);
  }
  delete(key: string) {
    return this.inner.delete(key);
  }
  exists(key: string) {
    return this.inner.exists(key);
  }
  list(prefix: string) {
    return this.inner.list(prefix);
  }
  getSignedUrl(key: string, options?: SignedUrlOptions) {
    return this.inner.getSignedUrl(key, options);
  }
  localPath(key: string) {
    return this.inner.localPath?.(key) ?? "";
  }
}
