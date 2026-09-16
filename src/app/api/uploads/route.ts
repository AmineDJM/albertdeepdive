import { NextResponse } from "next/server";
import { assertSameOrigin, getUserFromRequest, hasPermission } from "@/server/auth/session";
import { kickJobRunner } from "@/server/jobs/runner";
import { parseUploadForm, uploadMedia } from "@/server/media/upload";
import { AppError, ValidationError } from "@/lib/action-result";
import { createLogger } from "@/server/logger";

const log = createLogger("api:uploads");

export const maxDuration = 120;

function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    const status = err instanceof ValidationError ? 400 : err.status;
    return NextResponse.json(
      { error: err.message, code: err.code, fieldErrors: err.fieldErrors },
      { status },
    );
  }
  log.error("upload failed", { err });
  return NextResponse.json({ error: "Upload failed" }, { status: 500 });
}

/**
 * POST /api/uploads — multipart upload of one or many images by a newsroom user.
 * Fields: file (repeatable), editionId, storyId?, role?, caption?, altText?, photographer?, credit?,
 * rightsStatus?, rightsNote?, kind?, meta? (JSON array of per-file overrides, aligned with `file`).
 * Returns 201 { assets: [{ id, thumbUrl, webUrl, width, height, qualityScore, qualityFlags, duplicateOfId, … }] }.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
    if (!hasPermission(user, "media:manage"))
      return NextResponse.json({ error: "Missing permission: media:manage" }, { status: 403 });
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected a multipart/form-data body" }, { status: 400 });
    }
    const form = await request.formData();
    const parsed = await parseUploadForm(form);
    const assets = await uploadMedia({ ...parsed, actor: user });
    kickJobRunner();
    return NextResponse.json({ assets }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
