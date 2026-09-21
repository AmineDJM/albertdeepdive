import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";

/**
 * Which revision is actually serving.
 *
 * Render sets this on every build. Without it, "I pushed a fix and I still do not see it" has two
 * indistinguishable explanations — the deploy has not finished, or the fix is not in it — and the
 * only way to tell them apart is to wait and look again. Seven characters of commit hash settles it
 * in one request, and a commit hash on a public endpoint reveals nothing a repository does not.
 */
const revision = (process.env.RENDER_GIT_COMMIT ?? "").slice(0, 7) || "dev";

/** GET /api/health — liveness + database check, and the revision answering. */
export async function GET() {
  const time = new Date().toISOString();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: true, time, revision }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, db: false, time, revision, error: err instanceof Error ? err.message : "Database unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
