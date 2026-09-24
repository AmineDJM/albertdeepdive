import { and, asc, eq, ne } from "drizzle-orm";
import type { CurrentUser } from "@/server/auth/session";
import { getCurrentEdition, listEditions } from "@/server/editions/service";
import { listNotificationsForUser } from "@/server/editions/notifications";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { NewsroomShell } from "@/components/newsroom/shell";
import { listMyOrganizations, type TenantContext } from "@/server/tenancy/context";
import { usageReport } from "@/server/billing/entitlements";
import { getTranslations } from "@/server/i18n/locale";
import { experienceOf } from "@/lib/experience";

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
  const [workspaces, current, editions, notifications, report, t] = await Promise.all([
    listMyOrganizations(),
    tenant ? getCurrentEdition() : Promise.resolve(null),
    tenant ? listEditions() : Promise.resolve([] as Editions),
    listNotificationsForUser(user.id, 15),
    tenant ? usageReport(tenant.organizationId).catch(() => null) : Promise.resolve(null),
    getTranslations(),
  ]);
  // The plan, in one line: the tightest allowance is the one worth watching.
  const tightest = report?.lines.filter((line) => line.limit !== null).sort((a, b) => b.ratio - a.ratio)[0] ?? null;
  const plan = report ? { name: report.plan.planName, usedLabel: tightest ? `${tightest.used.toLocaleString()} / ${tightest.limit!.toLocaleString()} ${t(`billing.${tightest.key}` as "billing.publications").toLowerCase()}` : t("common.unlimited"), ratio: tightest ? tightest.ratio : null, href: "/settings/billing" } : null;
  // The newsletters, each with its editions, so the sidebar can light the one a page belongs to.
  const newsletters = tenant
    ? await db.query.publications.findMany({ where: and(eq(s.publications.organizationId, tenant.organizationId), ne(s.publications.status, "ARCHIVED")), orderBy: [asc(s.publications.sortOrder), asc(s.publications.name)], columns: { id: true, name: true } })
    : [];
  const editionsByNewsletter = new Map<string, string[]>();
  for (const edition of editions) if (edition.publicationId) editionsByNewsletter.set(edition.publicationId, [...(editionsByNewsletter.get(edition.publicationId) ?? []), edition.id]);
  return (
    <NewsroomShell
      user={{ name: user.name, email: user.email, role: user.role, viewingAs: user.viewingAs ?? null }}
      workspace={tenant ? { name: tenant.name, role: tenant.role } : null}
      workspaces={workspaces.map((w) => ({ organizationId: w.organizationId, name: w.name, slug: w.slug, role: w.role }))}
      impersonated={tenant?.impersonated ?? false}
      currentEditionId={current?.id ?? null}
      newsletters={newsletters.map((n) => ({ id: n.id, name: n.name, editionIds: editionsByNewsletter.get(n.id) ?? [] }))}
      notifications={notifications.rows.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, readAt: n.readAt, createdAt: n.createdAt, type: n.type }))}
      unread={notifications.unread}
      plan={plan}
      experience={experienceOf(user.preferences)}
    >
      {children}
    </NewsroomShell>
  );
}
