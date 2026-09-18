import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/server/auth/session";
import { NotFoundError } from "@/lib/action-result";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { renderPreviewHtml } from "@/server/publication/pdf";

export const dynamic = "force-dynamic";

/**
 * Live print preview of an edition's current state (page plan, articles, media as they are now,
 * including unapproved articles). Text areas that would overflow are outlined in the preview; the
 * real pagination (continuation pages) happens when a version is rendered.
 */
export async function GET(request: Request, { params }: { params: Promise<{ editionId: string }> }) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { editionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(editionId)) return NextResponse.json({ error: "Invalid edition id" }, { status: 400 });
  try {
    const document = await buildEditionDocument(editionId, { versionLabel: "preview", includeUnapproved: true });
    const html = renderPreviewHtml(document, { baseUrl: new URL(request.url).origin, editionId });
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "X-Frame-Options": "SAMEORIGIN",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Edition not found" }, { status: 404 });
    throw err;
  }
}
