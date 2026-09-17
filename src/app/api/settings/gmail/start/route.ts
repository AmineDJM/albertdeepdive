import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/session";
import { authorizeUrl, oauthConfigured, signState } from "@/server/email/google-oauth";

export const dynamic = "force-dynamic";

/** Begins "Sign in with Google": builds a signed state and sends the admin to Google's consent. */
export async function GET(request: Request) {
  try {
    await requirePermission("settings:manage");
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!oauthConfigured()) {
    return NextResponse.redirect(new URL("/settings/email?gmail=oauth_unavailable", request.url));
  }
  const state = signState(randomBytes(16).toString("hex"));
  return NextResponse.redirect(authorizeUrl(state));
}
