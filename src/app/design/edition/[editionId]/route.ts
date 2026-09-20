import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/server/auth/session";
import { NotFoundError } from "@/lib/action-result";
import { previewDesign } from "@/server/design/preview";

export const dynamic = "force-dynamic";

/**
 * The design, as it is now, in the medium you ask for.
 *
 * Live rather than exported: the screen beside it is a set of controls, and a control whose effect
 * you have to export a PDF to see is not a control. Web and email render in milliseconds because
 * neither needs a browser; print is the one that does, and it is reached from the same screen by
 * laying the pages out, which says how many there are and what spilled.
 */
export async function GET(request: Request, { params }: { params: Promise<{ editionId: string }> }) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { editionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(editionId)) return NextResponse.json({ error: "Invalid edition id" }, { status: 400 });

  const medium = new URL(request.url).searchParams.get("medium") === "email" ? "email" : "web";
  try {
    const html = await previewDesign(editionId, medium);
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
