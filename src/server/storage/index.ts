import { env } from "@/server/env";
import { LocalStorageAdapter } from "./local";
import type { StorageAdapter } from "./types";

let adapter: StorageAdapter | undefined;

export function getStorage(): StorageAdapter {
  if (adapter) return adapter;
  if (env.STORAGE_PROVIDER === "s3") {
    // Lazy import keeps the AWS SDK out of the local dev path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { S3StorageAdapter } = require("./s3") as typeof import("./s3");
    adapter = new S3StorageAdapter();
  } else {
    adapter = new LocalStorageAdapter();
  }
  return adapter;
}

export { storageKeys, extensionForMime } from "./keys";
export type { StorageAdapter, PutOptions, SignedUrlOptions } from "./types";
