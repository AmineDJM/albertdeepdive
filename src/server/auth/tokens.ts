import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/** Random opaque token (base64url) and its SHA-256 hash for storage. */
export function generateOpaqueToken(bytes = 32) {
  const token = randomBytes(bytes).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function hashIp(ip: string | null | undefined) {
  if (!ip) return null;
  return createHmac("sha256", env.AUTH_SECRET).update(ip).digest("hex").slice(0, 32);
}

/**
 * Signed, self-describing tokens for public links (submission invitations, information
 * requests). Format: base64url(payload).base64url(hmac). Payload is JSON with an `exp`.
 */
export function signPayload(payload: Record<string, unknown>, ttlSeconds: number) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", env.AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T extends Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", env.AUTH_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp: number };
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
