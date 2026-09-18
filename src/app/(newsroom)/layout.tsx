import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { getCurrentUser } from "@/server/auth/session";
import { NEWSROOM_ROLES } from "@/lib/auth/permissions";
import { PATHNAME_HEADER, worksWithoutWorkspace } from "@/lib/http/pathname";
import { getCurrentEdition, listEditions } from "@/server/editions/service";
import { listNotificationsForUser } from "@/server/editions/notifications";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NewsroomShell } from "@/components/newsroom/shell";
import { getTenant, homeWithoutWorkspace, listMyOrganizations } from "@/server/tenancy/context";

type Editions = Awaited<ReturnType<typeof listEditions>>;

export default async function NewsroomLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!NEWSROOM_ROLES.includes(user.role)) redirect("/login?reason=contributor");
  const [tenant, workspaces] = await Promise.all([getTenant(), listMyOrganizations()]);
  // Someone with no workspace has nothing to look at in the newsroom — every screen would be empty
  // — so they are sent where they belong: platform staff to the console, anyone else to create one.
  // The console itself, and the pages about the person rather than a workspace, work without one.
  if (!tenant) {
    const pathname = (await headers()).get(PATHNAME_HEADER);
    if (pathname && !worksWithoutWorkspace(pathname)) redirect(homeWithoutWorkspace(user));
  }
  const [current, editions, notifications] = await Promise.all([
    tenant ? getCurrentEdition() : Promise.resolve(null),
    tenant ? listEditions() : Promise.resolve([] as Editions),
    listNotificationsForUser(user.id, 15),
  ]);
  let badges = { inbox: 0, flags: 0 };
  if (current) {
    const [[inbox], [flags]] = await Promise.all([
      db.select({ n: count() }).from(s.submissions).where(and(eq(s.submissions.editionId, current.id), inArray(s.submissions.status, ["NEW", "NEEDS_REVIEW"]))),
      db.select({ n: sql<number>`count(*) filter (where jsonb_array_length(${s.stories.warnings}) > 0 or exists (select 1 from jsonb_array_elements(${s.stories.missingInformation}) m where coalesce((m->>'resolved')::boolean, false) = false))` }).from(s.stories).where(and(eq(s.stories.editionId, current.id), ne(s.stories.status, "REJECTED"), ne(s.stories.status, "DROPPED"))),
    ]);
    badges = { inbox: Number(inbox.n), flags: Number(flags.n) };
  }
  const toSidebar = (e: { id: string; label: string; issueNumber: number; isSpecialIssue: boolean; status: Editions[number]["status"] }) => ({ id: e.id, label: e.label, issueLabel: `${e.isSpecialIssue ? "Special issue" : "Issue"} N°${e.issueNumber}`, status: e.status });
  return (
    <NewsroomShell
      user={{ name: user.name, email: user.email, role: user.role, viewingAs: user.viewingAs ?? null }}
      workspace={tenant ? { name: tenant.name, role: tenant.role } : null}
      workspaces={workspaces.map((w) => ({ organizationId: w.organizationId, name: w.name, slug: w.slug, role: w.role }))}
      impersonated={tenant?.impersonated ?? false}
      currentEdition={current ? toSidebar(current) : null}
      editions={editions.filter((e) => e.status !== "ARCHIVED").slice(0, 8).map(toSidebar)}
      badges={badges}
      notifications={notifications.rows.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, readAt: n.readAt, createdAt: n.createdAt, type: n.type }))}
      unread={notifications.unread}
    >
      {children}
    </NewsroomShell>
  );
}
