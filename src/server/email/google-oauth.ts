import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/**
 * Google OAuth for the newsroom mailbox — the "Sign in with Google" path.
 *
 * It is optional: it turns on only when GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. The
 * scope is `https://mail.google.com/`, the one Gmail requires to send over SMTP and read over IMAP
 * with OAuth (XOAUTH2). We ask for offline access so Google returns a refresh token, which is all
 * we store; short-lived access tokens are fetched from it as needed.
 */
const SCOPE = "https://mail.google.com/ openid email";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export function oauthConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function redirectUri(): string {
  return `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/settings/gmail/callback`;
}

/** A signed, time-boxed state value, so the callback can prove the round trip started here. */
export function signState(nonce: string): string {
  const payload = `${nonce}.${Date.now()}`;
  const sig = createHmac("sha256", env.AUTH_SECRET).update(`gmail-oauth:${payload}`).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

export function verifyState(state: string | null | undefined, maxAgeMs = 15 * 60 * 1000): boolean {
  if (!state) return false;
  const [body, sig] = state.split(".");
  if (!body || !sig) return false;
  const payload = Buffer.from(body, "base64url").toString("utf8");
  const expected = createHmac("sha256", env.AUTH_SECRET).update(`gmail-oauth:${payload}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const ts = Number(payload.split(".")[1]);
  return Number.isFinite(ts) && Date.now() - ts < maxAgeMs;
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export type GoogleTokens = { accessToken: string; refreshToken: string | null; expiresInSeconds: number };

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `Google rejected the token request (${res.status})`);
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresInSeconds: data.expires_in ?? 3600 };
}

/** Trades the one-time code from the consent redirect for tokens (including the refresh token). */
export function exchangeCode(code: string): Promise<GoogleTokens> {
  return tokenRequest({
    code,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
}

/** A fresh access token from the stored refresh token, for an IMAP read. */
export function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  return tokenRequest({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID!,
    client_secret: env.GOOGLE_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
}

/** The address of the account that just authorised, so the mailbox is labelled correctly. */
export async function fetchConnectedEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => ({}))) as { email?: string; name?: string };
  return data.email ?? null;
}
