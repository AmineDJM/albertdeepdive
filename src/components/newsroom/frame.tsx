import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import type { CurrentUser } from "@/server/auth/session";
import { getCurrentEdition, listEditions } from "@/server/editions/service";
import { listNotificationsForUser } from "@/server/editions/notifications";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NewsroomShell } from "@/components/newsroom/shell";
import { listMyOrganizations, type TenantContext } from "@/server/tenancy/context";

type Editions = Awaited<ReturnType<typeof listEditions>>;

/**
 * The shell around every signed-in screen, with what it shows: the workspace, the edition in
 * progress, what needs a person, what happened.
 *
 * Shared by the newsroom, which always has a workspace, and the platform console, which may not.
 * With no tenant nothing of a workspace is loaded — no editions, no counts — and the shell draws
 * itself around the console alone.
 */
export async function NewsroomFrame({ user, tenant, children }: { user: CurrentUser; tenant: TenantContext | null; children: React.ReactNode }) {
  const [workspaces, current, editions, notifications] = await Promise.all([
    listMyOrganizations(),
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
