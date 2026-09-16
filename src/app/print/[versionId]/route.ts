import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/server/auth/session";
import { renderPreviewHtml } from "@/server/publication/pdf";
import { documentOfVersion, getVersion } from "@/server/publication/versions";

export const dynamic = "force-dynamic";

/**
 * On-screen print preview of a publication version's stored document: the same HTML the PDF
 * renderer uses (fixed A4 pages, running headers, pagination applied), with signed media URLs and
 * a grey desk background. Requires a signed-in newsroom user.
 */
export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { versionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return NextResponse.json({ error: "Invalid version id" }, { status: 400 });
  const version = await getVersion(versionId);
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const document = documentOfVersion(version);
  if (!document) return NextResponse.json({ error: "This version has no stored document yet" }, { status: 409 });
  const html = renderPreviewHtml(document, { baseUrl: new URL(request.url).origin });
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Frame-Options": "SAMEORIGIN",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
