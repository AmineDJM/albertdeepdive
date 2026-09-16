/**
 * Personal contribution links.
 *
 * The raw token is never stored: it is derived with an HMAC of the request id and the token
 * expiry, and only its SHA-256 hash lives in `submission_requests.token_hash`. The derivation
 * lets reminders re-send the *same* personal link, while changing the expiry (extension,
 * resend) rotates the token. Lookups always go through the hash.
 */
import { createHmac, randomInt } from "node:crypto";
import { env } from "@/server/env";
import { hashToken } from "@/server/auth/tokens";

export function mintRequestToken(requestId: string, tokenExpiresAt: Date): string {
  return createHmac("sha256", env.AUTH_SECRET).update(`submission-request:${requestId}:${tokenExpiresAt.getTime()}`).digest("base64url");
}

export function requestTokenHash(requestId: string, tokenExpiresAt: Date): string {
  return hashToken(mintRequestToken(requestId, tokenExpiresAt));
}

export function contributionLink(rawToken: string): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/contribute/${rawToken}`;
}

/** Tokens stay valid one week after the campaign closes, so late stragglers can still finish a draft. */
export const TOKEN_GRACE_DAYS = 7;

export function defaultTokenExpiry(graceEndsAt: Date, now = new Date()): Date {
  const base = Math.max(graceEndsAt.getTime(), now.getTime()) + TOKEN_GRACE_DAYS * 86_400_000;
  return new Date(base);
}

/** A fresh expiry that is guaranteed to change the derived token (used to rotate a link). */
export function rotatedTokenExpiry(graceEndsAt: Date, now = new Date()): Date {
  return new Date(defaultTokenExpiry(graceEndsAt, now).getTime() + randomInt(1, 60_000));
}

/** Plausible token shape (base64url of 32 bytes) — cheap rejection before hashing. */
export function looksLikeToken(value: string | undefined | null): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}
