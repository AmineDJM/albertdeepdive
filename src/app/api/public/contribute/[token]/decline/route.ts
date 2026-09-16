import { NextResponse } from "next/server";
import { publicHandler, readJson } from "@/server/submissions/http";
import { declineInvitation } from "@/server/submissions/public";

export const dynamic = "force-dynamic";

/** POST /api/public/contribute/[token]/decline — `{ reason? }` declines, `{ undo: true }` takes it back. */
export async function POST(request: Request, ctx: RouteContext<"/api/public/contribute/[token]/decline">) {
  return publicHandler(request, ctx.params, { mutating: true }, async ({ token, ip, userAgent }) => {
    const body = request.headers.get("content-type")?.includes("application/json") ? await readJson(request) : {};
    return NextResponse.json(await declineInvitation(token, body, { ip, userAgent }));
  });
}
