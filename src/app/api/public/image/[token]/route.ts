import { NextResponse } from "next/server";
import { durableImageKey, readDurableImageToken } from "@/server/media/durable";
import { getStorage } from "@/server/storage";

/** How long the storage address handed out here may be used, and how long an inbox may keep it. */
const SIGNED_FOR_SECONDS = 60 * 60;
const CACHE_SECONDS = 10 * 60;

/**
 * GET /api/public/image/[token] — one picture of a sent email, however long ago it was sent.
 *
 * The token is checked, the picture is looked up (deleted or rights refused: not found), and the
 * reader is sent to a freshly signed storage address. Nothing about the picture is in the token but
 * which one it is; see `src/server/media/durable.ts`.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/public/image/[token]">) {
  const { token } = await ctx.params;
  const named = readDurableImageToken(token);
  if (!named) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const key = await durableImageKey(named.assetId, named.kind);
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const signed = await (await getStorage()).getSignedUrl(key, { expiresInSeconds: SIGNED_FOR_SECONDS });
  const response = NextResponse.redirect(new URL(signed, request.url), 302);
  response.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
  return response;
}
