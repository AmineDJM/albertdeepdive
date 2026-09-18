import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { recordShowcaseEvent } from "@/server/showcase/service";

export const dynamic = "force-dynamic";

/**
 * What a visitor did in the gallery, counted.
 *
 * Open to anyone, because the gallery is. It takes a kind and at most two identifiers and writes a
 * row with today's date — no address, no cookie, nothing that could follow a person. It answers 204
 * whatever happens, including when the body is nonsense: this endpoint exists to count, and an
 * error here must never become an error a visitor sees.
 */
const schema = z.object({
  kind: z.enum(["COLLECTION_VIEW", "GALLERY_VIEW", "ITEM_OPEN", "SIGNUP_CLICK"]),
  collectionId: z.string().uuid().optional().nullable(),
  editionId: z.string().uuid().optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (parsed.success) await recordShowcaseEvent(parsed.data);
  } catch {
    // Counting is never worth an error page.
  }
  return new NextResponse(null, { status: 204 });
}
