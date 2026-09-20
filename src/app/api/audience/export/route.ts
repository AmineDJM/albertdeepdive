import { NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getUserFromRequest, hasPermission } from "@/server/auth/session";
import { organizationIdsForUser } from "@/server/tenancy/context";
import { csvHeaders, csvName, toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * The list, as a file.
 *
 * A table you can read and not take away is a table somebody retypes into a spreadsheet by hand,
 * so both lists come out with the columns that are on the screen. It is the whole list rather than
 * the page being looked at: an export of the first fifty rows is a trap, not a convenience.
 *
 * Scoped like every other read — the caller's own workspace, named in the cookie, never an id
 * passed in the query.
 */
export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!hasPermission(user, "contributor:manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const what = url.searchParams.get("what") === "contributors" ? "contributors" : "subscribers";
  const organizationId = url.searchParams.get("organizationId");
  const mine = await organizationIdsForUser(user!.id);
  // Platform staff may name a workspace; everybody else gets their own, whatever they ask for.
  const scope = user!.role === "SUPER_ADMIN" && organizationId ? organizationId : mine[0];
  if (!scope) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  if (what === "contributors") {
    const rows = await db.query.contributors.findMany({
      where: eq(s.contributors.organizationId, scope),
      orderBy: [asc(s.contributors.lastName), asc(s.contributors.firstName)],
      with: { campus: true, program: true, groupMemberships: { with: { group: true } } },
    });
    const csv = toCsv(rows, [
      { header: "First name", value: (row) => row.firstName },
      { header: "Last name", value: (row) => row.lastName },
      { header: "Email", value: (row) => row.email },
      { header: "Type", value: (row) => row.type },
      { header: "Campus", value: (row) => row.campus?.name ?? "" },
      { header: "Programme", value: (row) => row.program?.code ?? "" },
      { header: "Pools", value: (row) => row.groupMemberships.map((membership) => membership.group.name).join(" | ") },
      { header: "Active", value: (row) => (row.isActive ? "yes" : "no") },
      { header: "Added", value: (row) => row.createdAt.toISOString().slice(0, 10) },
    ]);
    return new NextResponse(csv, { headers: csvHeaders(csvName("contributors")) });
  }

  const rows = await db
    .select({
      email: s.subscribers.email,
      firstName: s.subscribers.firstName,
      lastName: s.subscribers.lastName,
      status: s.subscribers.status,
      locale: s.subscribers.locale,
      source: s.subscribers.source,
      confirmedAt: s.subscribers.confirmedAt,
      createdAt: s.subscribers.createdAt,
      unsubscribedAt: s.subscribers.unsubscribedAt,
      titles: sql<string>`coalesce((select string_agg(p.name, ' | ' order by p.name) from ${s.publicationSubscriptions} ps join ${s.publications} p on p.id = ps.publication_id where ps.subscriber_id = ${s.subscribers.id} and ps.is_active), '')`,
    })
    .from(s.subscribers)
    .where(and(eq(s.subscribers.organizationId, scope)))
    .orderBy(asc(s.subscribers.email));

  const csv = toCsv(rows, [
    { header: "Email", value: (row) => row.email },
    { header: "First name", value: (row) => row.firstName },
    { header: "Last name", value: (row) => row.lastName },
    { header: "Status", value: (row) => row.status },
    { header: "Newsletters", value: (row) => row.titles },
    { header: "Language", value: (row) => row.locale },
    { header: "Source", value: (row) => row.source },
    { header: "Confirmed", value: (row) => row.confirmedAt?.toISOString().slice(0, 10) ?? "" },
    { header: "Unsubscribed", value: (row) => row.unsubscribedAt?.toISOString().slice(0, 10) ?? "" },
    { header: "Added", value: (row) => row.createdAt.toISOString().slice(0, 10) },
  ]);
  return new NextResponse(csv, { headers: csvHeaders(csvName("subscribers")) });
}
