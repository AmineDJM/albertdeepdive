import { NextResponse } from "next/server";
import { AppError } from "@/lib/action-result";
import { env } from "@/server/env";
import { publicHandler, readJson, requireString } from "@/server/submissions/http";
import { RATE_LIMITS } from "@/server/submissions/rate-limit";
import { attachUpload, listUploads, removeUpload, updateUploadMeta } from "@/server/submissions/uploads";

export const dynamic = "force-dynamic";
/** Route handlers buffer the multipart body; keep it in line with the upload limit. */
export const maxDuration = 60;

/** GET /api/public/contribute/[token]/uploads?submissionId= — attachments of a draft. */
export async function GET(request: Request, ctx: RouteContext<"/api/public/contribute/[token]/uploads">) {
  return publicHandler(request, ctx.params, {}, async ({ token }) => {
    const submissionId = requireString(new URL(request.url).searchParams.get("submissionId"), "submissionId");
    return NextResponse.json({ attachments: await listUploads(submissionId, token) });
  });
}

/** POST /api/public/contribute/[token]/uploads — multipart: file, submissionId, caption?, photographer?. */
export async function POST(request: Request, ctx: RouteContext<"/api/public/contribute/[token]/uploads">) {
  return publicHandler(request, ctx.params, { mutating: true, rule: RATE_LIMITS.upload }, async ({ token }) => {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length && length > (env.UPLOAD_MAX_FILE_MB + 1) * 1024 * 1024) throw new AppError(`Files must be smaller than ${env.UPLOAD_MAX_FILE_MB} MB`, "FILE_TOO_LARGE", 413);
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError("Expected a multipart form", "BAD_REQUEST", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("Missing file", "BAD_REQUEST", 400);
    const submissionId = requireString(form.get("submissionId"), "submissionId");
    const caption = form.get("caption");
    const photographer = form.get("photographer");
    const result = await attachUpload(submissionId, token, {
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name || "upload",
      mimeType: file.type || null,
      caption: typeof caption === "string" ? caption : null,
      photographer: typeof photographer === "string" ? photographer : null,
    });
    return NextResponse.json(result, { status: 201 });
  });
}

/** PATCH /api/public/contribute/[token]/uploads — `{ submissionId, attachmentId, caption?, photographer? }`. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/public/contribute/[token]/uploads">) {
  return publicHandler(request, ctx.params, { mutating: true }, async ({ token }) => {
    const body = await readJson<{ submissionId?: unknown; attachmentId?: unknown; caption?: unknown; photographer?: unknown }>(request);
    const result = await updateUploadMeta(requireString(body.submissionId, "submissionId"), token, requireString(body.attachmentId, "attachmentId"), {
      caption: body.caption,
      photographer: body.photographer,
    });
    return NextResponse.json(result);
  });
}

/** DELETE /api/public/contribute/[token]/uploads — `{ submissionId, attachmentId }` (JSON body or query string). */
export async function DELETE(request: Request, ctx: RouteContext<"/api/public/contribute/[token]/uploads">) {
  return publicHandler(request, ctx.params, { mutating: true }, async ({ token }) => {
    const url = new URL(request.url);
    const body = request.headers.get("content-type")?.includes("application/json") ? await readJson<{ submissionId?: unknown; attachmentId?: unknown }>(request) : {};
    const submissionId = requireString(body.submissionId ?? url.searchParams.get("submissionId"), "submissionId");
    const attachmentId = requireString(body.attachmentId ?? url.searchParams.get("attachmentId"), "attachmentId");
    return NextResponse.json(await removeUpload(submissionId, token, attachmentId));
  });
}
