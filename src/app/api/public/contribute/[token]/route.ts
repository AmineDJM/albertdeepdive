import { NextResponse } from "next/server";
import { publicHandler } from "@/server/submissions/http";
import { resolveInvitation, toInvitationDTO } from "@/server/submissions/public";

export const dynamic = "force-dynamic";

/** GET /api/public/contribute/[token] — the invitation, the campaign and the current draft (no secrets). */
export async function GET(request: Request, ctx: RouteContext<"/api/public/contribute/[token]">) {
  return publicHandler(request, ctx.params, {}, async ({ token }) => {
    const resolved = await resolveInvitation(token, { markOpened: true });
    if (!resolved) return NextResponse.json({ error: "This link is not valid", code: "INVALID_LINK" }, { status: 404 });
    return NextResponse.json(await toInvitationDTO(resolved), { headers: { "Cache-Control": "private, no-store" } });
  });
}
