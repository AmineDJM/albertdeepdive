import { NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { costWindow, costsBreakdown, costsCsv } from "@/server/platform/insights";

export const dynamic = "force-dynamic";

/** The customer cost table as a file: the same figures the page shows, for a spreadsheet. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return new NextResponse("Forbidden", { status: 403 });
  const days = costWindow(new URL(request.url).searchParams.get("days") ?? undefined);
  const csv = costsCsv(await costsBreakdown(days));
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="briefly-costs-${days}d.csv"`,
      "cache-control": "no-store",
    },
  });
}
