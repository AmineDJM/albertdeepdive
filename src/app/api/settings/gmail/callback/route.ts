import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth/session";
import { exchangeCode, fetchConnectedEmail, oauthConfigured, verifyState } from "@/server/email/google-oauth";
import { connectGmailOAuth } from "@/server/email/gmail";
import { createLogger } from "@/server/logger";

export const dynamic = "force-dynamic";
const log = createLogger("api:gmail-oauth");

/** Google returns here after consent: exchange the code, store the mailbox, go back to Settings. */
export async function GET(request: Request) {
  let user;
  try {
    user = await requirePermission("settings:manage");
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const url = new URL(request.url);
  const back = (q: string) => NextResponse.redirect(new URL(`/settings/email?gmail=${q}`, request.url));

  if (!oauthConfigured()) return back("oauth_unavailable");
  if (url.searchParams.get("error")) return back("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !verifyState(state)) return back("bad_state");

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refreshToken) {
      // Google only returns a refresh token on first consent; force it by revoking access and retrying.
      return back("no_refresh_token");
    }
    const address = (await fetchConnectedEmail(tokens.accessToken)) ?? "";
    if (!address) return back("no_address");
    await connectGmailOAuth({ address, refreshToken: tokens.refreshToken }, user.id);
    return back("connected");
  } catch (err) {
    log.error("gmail oauth callback failed", { err });
    return back("error");
  }
}
