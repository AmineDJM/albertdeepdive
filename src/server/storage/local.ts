import { promises as fs } from "node:fs";
import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import type { SignedUrlOptions, StorageAdapter } from "./types";

function safeKey(key: string) {
  const normalized = path.posix.normalize(key).replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error("Invalid storage key");
  return normalized;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = "local" as const;
  private readonly root: string;

  constructor(root = env.STORAGE_LOCAL_DIR) {
    this.root = path.resolve(process.cwd(), root);
  }

  localPath(key: string) {
    return path.join(this.root, safeKey(key));
  }

  async put(key: string, body: Buffer | Uint8Array) {
    const target = this.localPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
    return { key: safeKey(key), size: body.byteLength };
  }

  async get(key: string) {
    try {
      return await fs.readFile(this.localPath(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string) {
    await fs.rm(this.localPath(key), { force: true });
  }

  async exists(key: string) {
    try {
      await fs.access(this.localPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions) {
    const k = safeKey(key);
    const exp = Math.floor(Date.now() / 1000) + (options?.expiresInSeconds ?? env.STORAGE_SIGNED_URL_TTL_SECONDS);
    const sig = signLocal(k, exp);
    const params = new URLSearchParams({ exp: String(exp), sig });
    if (options?.download) params.set("download", options.download.fileName);
    return `${env.NEXT_PUBLIC_APP_URL}/api/storage/${k.split("/").map(encodeURIComponent).join("/")}?${params.toString()}`;
  }
}

export function signLocal(key: string, exp: number) {
  return createHmac("sha256", env.AUTH_SECRET).update(`${key}:${exp}`).digest("base64url");
}

export function verifyLocalSignature(key: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = Buffer.from(signLocal(key, exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
