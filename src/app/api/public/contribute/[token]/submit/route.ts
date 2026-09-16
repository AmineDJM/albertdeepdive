import { NextResponse } from "next/server";
import { publicHandler, readJson, requireString } from "@/server/submissions/http";
import { submitDraft } from "@/server/submissions/public";

export const dynamic = "force-dynamic";

/** POST /api/public/contribute/[token]/submit — `{ submissionId, payload }` → `{ submissionId }`. */
export async function POST(request: Request, ctx: RouteContext<"/api/public/contribute/[token]/submit">) {
  return publicHandler(request, ctx.params, { mutating: true }, async ({ token, ip, userAgent }) => {
    const body = await readJson<{ submissionId?: unknown; payload?: unknown }>(request);
    const submissionId = requireString(body.submissionId, "submissionId");
    const result = await submitDraft(submissionId, token, body.payload ?? {}, { ip, userAgent });
    return NextResponse.json(result, { status: 201 });
  });
}
