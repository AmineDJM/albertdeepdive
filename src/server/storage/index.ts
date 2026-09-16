import { env } from "@/server/env";
import { LocalStorageAdapter } from "./local";
import { S3StorageAdapter } from "./s3";
import type { StorageAdapter } from "./types";

let adapter: StorageAdapter | undefined;

export function getStorage(): StorageAdapter {
  if (adapter) return adapter;
  // Static imports: a lazy require() is not resolvable under ESM (tests, the worker CLI), and the
  // S3 client is only instantiated when the provider is actually configured.
  adapter = env.STORAGE_PROVIDER === "s3" ? new S3StorageAdapter() : new LocalStorageAdapter();
  return adapter;
}

export { storageKeys, extensionForMime } from "./keys";
export type { StorageAdapter, PutOptions, SignedUrlOptions } from "./types";
