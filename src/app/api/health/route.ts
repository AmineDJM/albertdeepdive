import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** GET /api/health — liveness + database check. */
export async function GET() {
  const time = new Date().toISOString();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: true, time }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ ok: false, db: false, time, error: err instanceof Error ? err.message : "Database unreachable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
