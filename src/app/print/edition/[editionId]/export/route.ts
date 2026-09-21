import { NextResponse } from "next/server";
import { getUserFromRequest, hasPermission } from "@/server/auth/session";
import { NotFoundError } from "@/lib/action-result";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { runAsOrganization } from "@/server/tenancy/context";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { and, eq } from "drizzle-orm";
import { slugify } from "@/lib/utils";
import { createLogger } from "@/server/logger";
import { editionHasContent } from "@/server/publication/readiness";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("preview-export");

/**
 * The edition you are looking at, as a file.
 *
 * The preview shows the edition exactly as it stands, unapproved articles included, and the obvious
 * next thought is "I want this to send to somebody". Until now that meant leaving the preview,
 * finding the exports tab, queueing a version and waiting for it. This renders the same document
 * the preview is drawing, right now, and hands it back as a download.
 *
 * It is deliberately not a version: nothing is stored, nothing is numbered, and the file says
 * "preview" in its name. A version is the edition as approved, which is a different promise and
 * keeps its own audit trail.
 */
export async function GET(request: Request, { params }: { params: Promise<{ editionId: string }> }) {
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { editionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(editionId)) return NextResponse.json({ error: "Invalid edition id" }, { status: 400 });
  const format = new URL(request.url).searchParams.get("format") === "docx" ? "docx" : "pdf";

  // Reading an edition is one permission; taking a copy of it away is the same one. Anything a
  // person can already read in the preview, they may already screenshot.
  if (!hasPermission(user, "edition:view")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId), columns: { id: true, organizationId: true, label: true, slug: true } });
  if (!edition) return NextResponse.json({ error: "Edition not found" }, { status: 404 });
  // The ambient organisation is what every scoped query reads, so the render runs inside the
  // edition's own workspace rather than whichever one the session happens to have open.
  const isPlatformStaff = (user.viewingAs?.realRole ?? user.role) === "SUPER_ADMIN";
  const member = edition.organizationId
    ? await db.query.organizationMembers.findFirst({ where: and(eq(s.organizationMembers.userId, user.id), eq(s.organizationMembers.organizationId, edition.organizationId)), columns: { organizationId: true } })
    : null;
  if (!isPlatformStaff && !member) return NextResponse.json({ error: "Not allowed" }, { status: 404 });

  // An empty issue still renders: a cover, the page furniture, and no newsletter behind it. Handing
  // that back as a .pdf is worse than refusing, because it looks like the product's best effort.
  if (!(await runAsOrganization(edition.organizationId!, () => editionHasContent(editionId)))) {
    return NextResponse.json({ error: "This edition has no written article yet, so there is nothing to export." }, { status: 409 });
  }

  try {
    const started = Date.now();
    const { body, contentType, extension } = await runAsOrganization(edition.organizationId!, async () => {
      const document = await buildEditionDocument(editionId, { versionLabel: "preview", includeUnapproved: true });
      if (format === "docx") {
        const { renderDocx } = await import("@/server/publication/docx");
        return { body: await renderDocx(document), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" };
      }
      const { renderPdf } = await import("@/server/publication/pdf");
      const result = await renderPdf(document);
      return { body: result.buffer, contentType: "application/pdf", extension: "pdf" };
    });
    const fileName = `${slugify(edition.label || edition.slug || "edition")}-preview.${extension}`;
    log.info("preview exported", { editionId, format, bytes: body.byteLength, ms: Date.now() - started });
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(body.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    if (err instanceof NotFoundError) return NextResponse.json({ error: "Edition not found" }, { status: 404 });
    log.error("preview export failed", { editionId, format, err });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not make the file" }, { status: 500 });
  }
}
