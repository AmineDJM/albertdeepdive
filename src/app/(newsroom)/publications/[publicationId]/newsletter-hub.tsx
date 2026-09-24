import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { PageHeader } from "@/components/newsroom/page-header";
import { TabBar } from "@/components/newsroom/tab-bar";
import { getUi } from "@/server/i18n/locale";
import { NewsletterName } from "./newsletter-name";

export type NewsletterHubPublication = typeof s.publications.$inferSelect;

/** The newsletter a hub page is about, in the workspace in scope, or a 404. */
export async function hubPublication(publicationId: string): Promise<NewsletterHubPublication> {
  const tenant = await requireTenant();
  const publication = await db.query.publications.findFirst({ where: and(eq(s.publications.id, publicationId), eq(s.publications.organizationId, tenant.organizationId)) });
  if (!publication) notFound();
  return publication;
}

/**
 * The top of every page of a newsletter.
 *
 * A newsletter is the thing that lasts, and everything about it lives under it: its editions, its
 * pictures, the people who read it and the people who write for it. So each of those is a tab of
 * the newsletter rather than a workspace-wide page that mixed every title's pictures and readers.
 * Back goes Home, where the newsletters are; the name is changed where it is read.
 */
export async function NewsletterHubHeader({ publication, actions, description }: { publication: NewsletterHubPublication; actions?: React.ReactNode; description?: React.ReactNode }) {
  const [tr, user] = await Promise.all([getUi(), getCurrentUser()]);
  const base = `/publications/${publication.id}`;
  const tabs = [
    { href: base, label: tr("Editions"), exact: true },
    { href: `${base}/library`, label: tr("Library") },
    ...(hasPermission(user, "contributor:manage")
      ? [
          { href: `${base}/subscribers`, label: tr("Subscribers") },
          { href: `${base}/contributors`, label: tr("Contributors") },
        ]
      : []),
  ];
  return (
    <PageHeader
      back={{ href: "/overview", label: tr("Home") }}
      title={<NewsletterName publicationId={publication.id} name={publication.name} canRename={hasPermission(user, "edition:edit")} />}
      description={description ?? publication.description ?? tr("A recurring title. Each edition inside it starts where the last one left off.")}
      actions={actions}
    >
      <div className="px-3">
        <TabBar tabs={tabs} />
      </div>
    </PageHeader>
  );
}
