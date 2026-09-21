import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/server/auth/session";
import { NotFoundError } from "@/lib/action-result";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { renderPreviewHtml } from "@/server/publication/pdf";
import { editionHasContent } from "@/server/publication/readiness";
import { nothingToPreviewHtml } from "@/server/publication/empty-preview";

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
    // Nothing written yet: say so, rather than draw a cover over an empty issue. This URL gets
    // bookmarked and passed around, so the answer lives here and not only on the button.
    if (!(await editionHasContent(editionId))) {
      // The reader's own language, taken from the session we already resolved rather than from the
      // request-scoped helpers, which expect a page render and not a route handler.
      const locale = (user.preferences as { locale?: string } | undefined)?.locale === "fr" ? "fr" : "en";
      return new NextResponse(nothingToPreviewHtml(editionId, locale), {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Frame-Options": "SAMEORIGIN", "X-Content-Type-Options": "nosniff" },
      });
    }
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
