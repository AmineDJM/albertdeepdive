import { NextResponse } from "next/server";
import { publicHandler, readJson, requireString } from "@/server/submissions/http";
import { getOrCreateDraft, resolveInvitation, saveDraft, startAnotherDraft, InvalidLinkError } from "@/server/submissions/public";

export const dynamic = "force-dynamic";

/** PATCH /api/public/contribute/[token]/draft — autosave `{ submissionId, patch }`. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/public/contribute/[token]/draft">) {
  return publicHandler(request, ctx.params, { mutating: true }, async ({ token }) => {
    const body = await readJson<{ submissionId?: unknown; patch?: unknown }>(request);
    const submissionId = requireString(body.submissionId, "submissionId");
    const result = await saveDraft(submissionId, token, body.patch ?? {});
    return NextResponse.json(result);
  });
}

/** POST /api/public/contribute/[token]/draft — `{ another: true }` starts a fresh draft, otherwise returns the current one. */
export async function POST(request: Request, ctx: RouteContext<"/api/public/contribute/[token]/draft">) {
  return publicHandler(request, ctx.params, { mutating: true }, async ({ token }) => {
    const resolved = await resolveInvitation(token, { markOpened: false });
    if (!resolved) throw new InvalidLinkError();
    const body = request.headers.get("content-type")?.includes("application/json") ? await readJson<{ another?: unknown }>(request) : {};
    const draft = body.another === true ? await startAnotherDraft(resolved.request.id) : await getOrCreateDraft(resolved.request.id);
    return NextResponse.json({ draft });
  });
}
