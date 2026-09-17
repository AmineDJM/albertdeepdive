import { NextResponse, type NextRequest } from "next/server";

// `/s` is where readers live: the subscribe page for a title, and the confirm and unsubscribe links
// sent to them by email. None of it belongs behind a sign-in — a reader has no account.
const PUBLIC_PREFIXES = ["/login", "/contribute", "/respond", "/s", "/r", "/api/public", "/api/webhooks", "/api/storage", "/api/automations", "/api/health", "/print", "/fonts", "/_next", "/favicon.ico", "/icon.svg"];

/** Pages anyone may open without a session: the landing page and what search engines read. */
const PUBLIC_EXACT = new Set(["/", "/sitemap.xml", "/robots.txt", "/opengraph-image", "/icon.svg", "/manifest.webmanifest"]);

/** Lightweight gate: unauthenticated visitors (no session cookie) are sent to /login. Real authorization happens server-side. */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_EXACT.has(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  const hasSession = request.cookies.has("add_session");
  if (!hasSession) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/).*)"],
};
