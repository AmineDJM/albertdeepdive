import Link from "next/link";
import { Users } from "lucide-react";
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
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<string, "default" | "muted" | "success" | "warning" | "destructive"> = {
  SUBSCRIBED: "success",
  PENDING: "warning",
  UNSUBSCRIBED: "muted",
  BOUNCED: "destructive",
  COMPLAINED: "destructive",
};

export default async function SubscribersPage() {
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  if (!hasPermission(user, "contributor:manage")) {
    return (
      <>
        <PageHeader title="Subscribers" />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">You do not have access to the subscriber list.</p>
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
      <PageHeader title="Subscribers" description="The people who asked to receive your publications. Everyone here confirmed their address."
      >
        <HubTabs tabs={AUDIENCE_TABS} />
      </PageHeader>
      <PageBody className="space-y-5">
        <StatGrid>
          <Stat label="Confirmed" value={stats.subscribed} />
          <Stat label="Awaiting confirmation" value={stats.pending} />
          <Stat label="Unsubscribed" value={stats.unsubscribed} />
          <Stat label="Bounced" value={stats.bounced} />
        </StatGrid>

        {titles.length ? (
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="label-caps mb-2">Share these links</p>
            <ul className="space-y-1">
              {titles.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-[13px]">
                  <span className="w-44 shrink-0 truncate font-medium">{t.name}</span>
                  <Link href={`/s/${t.subscribeSlug}`} className="font-mono text-2xs text-muted-foreground underline-offset-4 hover:underline">
                    /s/{t.subscribeSlug}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty={{
            title: "No subscribers yet",
            description: "Share a title's subscribe link and people can sign themselves up.",
            icon: Users,
          }}
          columns={[
            {
              key: "who",
              header: "Reader",
              cell: (r) => (
                <span className="flex flex-col">
                  <span className="font-medium">{[r.firstName, r.lastName].filter(Boolean).join(" ") || r.email}</span>
                  {r.firstName || r.lastName ? <span className="text-xs text-muted-foreground">{r.email}</span> : null}
                </span>
              ),
            },
            { key: "status", header: "Status", cell: (r) => <Badge variant={STATUS_VARIANT[r.status] ?? "muted"}>{r.status.toLowerCase()}</Badge> },
            { key: "titles", header: "Titles", cell: (r) => <span className="tabular">{Number(r.titles)}</span>, align: "right" },
            { key: "locale", header: "Language", cell: (r) => <span className="text-xs uppercase">{r.locale}</span> },
            { key: "source", header: "Source", cell: (r) => <span className="text-xs text-muted-foreground">{r.source}</span> },
            { key: "since", header: "Since", cell: (r) => <span className="text-xs text-muted-foreground">{formatDate(r.confirmedAt ?? r.createdAt)}</span>, align: "right" },
          ]}
        />
      </PageBody>
    </>
  );
}
