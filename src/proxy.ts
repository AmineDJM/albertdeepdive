import { NextResponse, type NextRequest } from "next/server";

// `/s` is where readers live: the subscribe page for a title, and the confirm and unsubscribe links
// sent to them by email. `/c` is the same door for the people who write it. None of it belongs
// behind a sign-in — neither a reader nor somebody offering to write has an account.
const PUBLIC_PREFIXES = ["/login", "/signup", "/contribute", "/respond", "/s", "/c", "/r", "/api/public", "/collections", "/api/webhooks", "/api/storage", "/api/automations", "/api/health", "/print", "/fonts", "/brand", "/_next", "/favicon.ico", "/icon.png", "/apple-icon.png"];

/** Pages anyone may open without a session: the landing page and what search engines read. */
const PUBLIC_EXACT = new Set(["/", "/sitemap.xml", "/robots.txt", "/opengraph-image", "/icon.png", "/apple-icon.png", "/manifest.webmanifest"]);

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
