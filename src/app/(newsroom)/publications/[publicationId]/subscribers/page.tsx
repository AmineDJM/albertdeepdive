import Link from "next/link";
import { Upload, Users } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { PageBody } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddSubscriber } from "@/components/subscribers/add-subscriber";
import { ShareLinks } from "@/components/newsroom/share-links";
import { NoAccess } from "@/components/settings/no-access";
import { formatDate } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";
import { hubPublication, NewsletterHubHeader } from "../newsletter-hub";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "default" | "muted" | "success" | "warning" | "destructive"> = {
  SUBSCRIBED: "success",
  PENDING: "warning",
  UNSUBSCRIBED: "muted",
  BOUNCED: "destructive",
  COMPLAINED: "destructive",
};

/**
 * The people who read this newsletter.
 *
 * Its own list, not the workspace's: somebody subscribed to the alumni review is not a reader of
 * the portfolio letter. The subscribe link, adding a reader by hand and the numbers are all this
 * newsletter's.
 */
export default async function NewsletterSubscribersPage({ params }: { params: Promise<{ publicationId: string }> }) {
  const tr = await getUi();
  const { publicationId } = await params;
  const [publication, user] = await Promise.all([hubPublication(publicationId), getCurrentUser()]);
  if (!hasPermission(user, "contributor:manage")) return <NoAccess title={tr("Subscribers")} permission="contributor:manage" />;

  const rows = await db
    .select({
      id: s.subscribers.id,
      email: s.subscribers.email,
      firstName: s.subscribers.firstName,
      lastName: s.subscribers.lastName,
      status: s.subscribers.status,
      source: s.subscribers.source,
      locale: s.subscribers.locale,
      createdAt: s.subscribers.createdAt,
      confirmedAt: s.subscribers.confirmedAt,
      active: s.publicationSubscriptions.isActive,
      paymentStatus: s.publicationSubscriptions.paymentStatus,
      subscribedAt: s.publicationSubscriptions.subscribedAt,
    })
    .from(s.publicationSubscriptions)
    .innerJoin(s.subscribers, eq(s.subscribers.id, s.publicationSubscriptions.subscriberId))
    .where(and(eq(s.publicationSubscriptions.publicationId, publication.id), eq(s.subscribers.organizationId, publication.organizationId)))
    .orderBy(desc(s.publicationSubscriptions.subscribedAt))
    .limit(1000);

  const reading = rows.filter((row) => row.active && row.status === "SUBSCRIBED");
  const count = (status: string) => rows.filter((row) => row.status === status).length;

  return (
    <>
      <NewsletterHubHeader
        publication={publication}
        description={tr("The people who receive this newsletter.")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/subscribers/import">
                <Upload /> {tr("Import from a file")}
              </Link>
            </Button>
            <AddSubscriber titles={[{ id: publication.id, name: publication.name }]} />
          </div>
        }
      />
      <PageBody className="space-y-5">
        <StatGrid columns={4}>
          <Stat label={tr("Reading it")} value={reading.length} hint={tr("confirmed and subscribed")} />
          <Stat label={tr("Paying")} value={rows.filter((row) => row.paymentStatus === "active" || row.paymentStatus === "past_due").length} />
          <Stat label={tr("Awaiting confirmation")} value={count("PENDING")} />
          <Stat label={tr("Unsubscribed")} value={rows.filter((row) => !row.active).length} />
        </StatGrid>

        {publication.subscribeSlug && publication.isPublic ? (
          <ShareLinks title={tr("Share this link")} description={tr("Anybody who follows it can subscribe to this newsletter.")} links={[{ label: publication.name, path: `/s/${publication.subscribeSlug}` }]} />
        ) : null}

        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty={{ title: tr("No subscribers yet"), description: tr("Share the subscribe link, add readers by hand, or import a file."), icon: Users }}
          columns={[
            {
              key: "who",
              header: tr("Reader"),
              cell: (r) => (
                <span className="flex flex-col">
                  <span className="font-medium">{[r.firstName, r.lastName].filter(Boolean).join(" ") || r.email}</span>
                  {r.firstName || r.lastName ? <span className="text-xs text-muted-foreground">{r.email}</span> : null}
                </span>
              ),
            },
            {
              key: "status",
              header: tr("Status"),
              cell: (r) => (
                <span className="flex items-center gap-1.5">
                  <Badge variant={r.active ? (STATUS_VARIANT[r.status] ?? "muted") : "muted"}>{r.active ? r.status.toLowerCase() : tr("unsubscribed")}</Badge>
                  {r.paymentStatus === "active" ? <Badge variant="brand">{tr("paying")}</Badge> : null}
                </span>
              ),
            },
            { key: "locale", header: tr("Language"), cell: (r) => <span className="text-xs uppercase">{r.locale}</span> },
            { key: "source", header: tr("Source"), cell: (r) => <span className="text-xs text-muted-foreground">{r.source}</span> },
            { key: "since", header: tr("Since"), cell: (r) => <span className="text-xs text-muted-foreground">{formatDate(r.subscribedAt ?? r.confirmedAt ?? r.createdAt)}</span>, align: "right" },
          ]}
        />
      </PageBody>
    </>
  );
}
