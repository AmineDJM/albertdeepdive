import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { systemSettings } from "@/server/db/schema";
import { env } from "@/server/env";

/**
 * Secrets an operator types into the interface — today the Gmail app password — are stored
 * encrypted, never in clear text. The key is derived from AUTH_SECRET, so a database dump on its
 * own is not enough to read them, and rotating AUTH_SECRET invalidates them (the connection is
 * simply set up again).
 */
const ALGORITHM = "aes-256-gcm";
const KEY = scryptSync(env.AUTH_SECRET, "albert-deep-dive:settings", 32);

export type SealedSecret = { v: 1; iv: string; tag: string; data: string };

export function seal(plaintext: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export function open(sealed: SealedSecret | null | undefined): string | null {
  if (!sealed || sealed.v !== 1) return null;
  try {
    const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key (AUTH_SECRET changed) or tampered value: treat it as "not configured".
    return null;
  }
}

/** Shows enough of a secret to recognise it, never enough to use it. */
export function maskSecret(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 4 ? "••••" : `${"•".repeat(Math.min(12, value.length - 4))}${value.slice(-4)}`;
}

export async function readSecretSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select({ value: systemSettings.value }).from(systemSettings).where(eq(systemSettings.key, key));
  return (row?.value as T) ?? null;
}

export async function writeSecretSetting(key: string, value: unknown, description: string, userId?: string | null) {
  await db
    .insert(systemSettings)
    .values({ key, value, description, updatedById: userId ?? null })
    .onConflictDoUpdate({ target: systemSettings.key, set: { value, description, updatedById: userId ?? null, updatedAt: new Date() } });
}

export async function deleteSecretSetting(key: string) {
  await db.delete(systemSettings).where(eq(systemSettings.key, key));
}
