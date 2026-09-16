import { NextResponse } from "next/server";
import { assertSameOrigin, getUserFromRequest, hasPermission } from "@/server/auth/session";
import { NEWSROOM_ROLES } from "@/lib/auth/permissions";
import { AppError } from "@/lib/action-result";
import { getMediaDetail } from "@/server/media/library";
import { archiveMedia, updateMediaMetadata } from "@/server/media/rights";
import { createLogger } from "@/server/logger";

const log = createLogger("api:media");

function errorResponse(err: unknown) {
  if (err instanceof AppError)
    return NextResponse.json(
      { error: err.message, code: err.code, fieldErrors: err.fieldErrors },
      { status: err.status },
    );
  log.error("media route failed", { err });
  return NextResponse.json({ error: "Request failed" }, { status: 500 });
}

/** GET /api/media/[assetId] — full detail (signed URLs, variants, usage) for pickers and previews. */
export async function GET(request: Request, ctx: RouteContext<"/api/media/[assetId]">) {
  try {
    const { assetId } = await ctx.params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    if (!NEWSROOM_ROLES.includes(user.role))
      return NextResponse.json({ error: "Newsroom access required" }, { status: 403 });
    const detail = await getMediaDetail(assetId);
    return NextResponse.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH /api/media/[assetId] — caption / alt text / photographer / credit / kind. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/media/[assetId]">) {
  try {
    assertSameOrigin(request);
    const { assetId } = await ctx.params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    if (!hasPermission(user, "media:manage"))
      return NextResponse.json({ error: "Missing permission: media:manage" }, { status: 403 });
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object")
      return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
    const asset = await updateMediaMetadata(assetId, body, user);
    const { storageKey: _key, ...safe } = asset;
    void _key;
    return NextResponse.json({ asset: safe });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/media/[assetId] — archives the asset (files are kept; nothing is ever hard-deleted). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/media/[assetId]">) {
  try {
    assertSameOrigin(request);
    const { assetId } = await ctx.params;
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    if (!hasPermission(user, "media:manage"))
      return NextResponse.json({ error: "Missing permission: media:manage" }, { status: 403 });
    const asset = await archiveMedia(assetId, user);
    return NextResponse.json({ ok: true, asset: { id: asset.id, isArchived: asset.isArchived } });
  } catch (err) {
    return errorResponse(err);
  }
}
