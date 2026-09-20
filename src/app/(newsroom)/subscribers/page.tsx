import Link from "next/link";
import { Download, Upload, Users } from "lucide-react";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { subscriberStats } from "@/server/subscribers/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { AUDIENCE_TABS } from "@/components/newsroom/nav";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddSubscriber } from "@/components/subscribers/add-subscriber";
import { ShareLinks } from "@/components/newsroom/share-links";
import { formatDate } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "default" | "muted" | "success" | "warning" | "destructive"> = {
  SUBSCRIBED: "success",
  PENDING: "warning",
  UNSUBSCRIBED: "muted",
  BOUNCED: "destructive",
  COMPLAINED: "destructive",
};

export default async function SubscribersPage() {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  if (!hasPermission(user, "contributor:manage")) {
    return (
      <>
        <PageHeader title={tr("Subscribers")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("You do not have access to the subscriber list.")}</p>
        </PageBody>
      </>
    );
  }

  const [stats, rows, titles] = await Promise.all([
    subscriberStats(tenant.organizationId),
    db
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
        titles: sql<number>`(select count(*) from ${s.publicationSubscriptions} ps where ps.subscriber_id = ${s.subscribers.id} and ps.is_active)`,
        paying: sql<number>`(select count(*) from ${s.publicationSubscriptions} ps where ps.subscriber_id = ${s.subscribers.id} and ps.is_active and ps.payment_status in ('active', 'past_due'))`,
      })
      .from(s.subscribers)
      .where(eq(s.subscribers.organizationId, tenant.organizationId))
      .orderBy(desc(s.subscribers.createdAt))
      .limit(500),
    db
      .select({ id: s.publications.id, name: s.publications.name, subscribeSlug: s.publications.subscribeSlug, isPublic: s.publications.isPublic })
      .from(s.publications)
      .where(and(eq(s.publications.organizationId, tenant.organizationId), eq(s.publications.isPublic, true))),
  ]);

  return (
    <>
      <PageHeader
        title={tr("Subscribers")}
        description={tr("The people who receive your publications — the ones who signed themselves up, and the ones you added.")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <a href="/api/audience/export?what=subscribers" download>
                <Download /> {tr("Export")}
              </a>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/subscribers/import">
                <Upload /> {tr("Import from a file")}
              </Link>
            </Button>
            <AddSubscriber titles={titles.map((title) => ({ id: title.id, name: title.name }))} />
          </div>
        }
      >
        <HubTabs tabs={AUDIENCE_TABS} />
      </PageHeader>
      <PageBody className="space-y-5">
        <StatGrid>
          <Stat label={tr("Confirmed")} value={stats.subscribed} />
          <Stat label={tr("Paying")} value={rows.filter((r) => Number(r.paying) > 0).length} hint={tr("through your Stripe")} href="/settings/payments" />
          <Stat label={tr("Awaiting confirmation")} value={stats.pending} />
          <Stat label={tr("Unsubscribed")} value={stats.unsubscribed} />
          <Stat label={tr("Bounced")} value={stats.bounced} />
        </StatGrid>

        {titles.length ? (
          <ShareLinks
            title={tr("Share these links")}
            description={tr("One link per newsletter, and one where a reader ticks the ones they want.")}
            links={[
              ...titles.filter((title) => title.subscribeSlug).map((title) => ({ label: title.name, path: `/s/${title.subscribeSlug}` })),
              ...(titles.length > 1 ? [{ label: tr("All of them"), path: `/s/all/${tenant.slug}`, hint: tr("they tick what they want") }] : []),
            ]}
          />
        ) : null}

        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty={{
            title: tr("No subscribers yet"),
            description: tr("Share a title's subscribe link and people can sign themselves up."),
            icon: Users,
          }}
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
                  <Badge variant={STATUS_VARIANT[r.status] ?? "muted"}>{r.status.toLowerCase()}</Badge>
                  {Number(r.paying) > 0 ? <Badge variant="brand">{tr("paying")}</Badge> : null}
                </span>
              ),
            },
            { key: "titles", header: tr("Titles"), cell: (r) => <span className="tabular">{Number(r.titles)}</span>, align: "right" },
            { key: "locale", header: tr("Language"), cell: (r) => <span className="text-xs uppercase">{r.locale}</span> },
            { key: "source", header: tr("Source"), cell: (r) => <span className="text-xs text-muted-foreground">{r.source}</span> },
            { key: "since", header: tr("Since"), cell: (r) => <span className="text-xs text-muted-foreground">{formatDate(r.confirmedAt ?? r.createdAt)}</span>, align: "right" },
          ]}
        />
      </PageBody>
    </>
  );
}
