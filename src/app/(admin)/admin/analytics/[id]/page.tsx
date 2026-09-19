import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { workspaceAnalyticsForAdmin, workspaceCostsForAdmin } from "@/server/platform/analytics";
import { percentLabel } from "@/server/analytics/compute";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Button } from "@/components/ui/button";
import { formatBytes, formatCents, formatTokens } from "@/lib/format";
import { formatNumber } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * One customer, through the console.
 *
 * The top half is exactly what that customer sees on their own Analytics page — the same readers,
 * given a scope built from this id — so support is looking at the figures the customer is looking
 * at rather than at a second implementation that drifts. The bottom half is what they do not see
 * and should not: what their month costs to run.
 */
export default async function AdminWorkspaceAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Platform analytics")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Reading a customer's figures is a platform job. You need to be a Briefly super admin.")}</p>
        </PageBody>
      </>
    );
  }

  const { id } = await params;
  const raw = (await searchParams).days;
  const days = [7, 30, 90].includes(Number(Array.isArray(raw) ? raw[0] : raw)) ? Number(Array.isArray(raw) ? raw[0] : raw) : 30;

  const view = await workspaceAnalyticsForAdmin(id, days).catch(() => null);
  if (!view?.organization) notFound();
  const costs = await workspaceCostsForAdmin(id, days);
  const { analytics, delivery, deliveryByEdition, funnel, comparison, rights, top } = view;

  return (
    <>
      <PageHeader
        title={view.organization.name}
        description={`${tr("What this customer publishes and who reads it, over the last")} ${days} ${tr("days")}.`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/analytics?days=${days}`}>
              <ArrowLeft /> {tr("All customers")}
            </Link>
          </Button>
        }
      />
      <PageBody className="space-y-6">
        <section>
          <SectionTitle>{tr("What they made")}</SectionTitle>
          <StatGrid columns={4}>
            <Stat label={tr("Submissions")} value={formatNumber(funnel.steps[0]?.value ?? 0)} hint={`${percentLabel(funnel.acceptedRate)} ${tr("kept after triage")}`} />
            <Stat label={tr("Stories selected")} value={formatNumber(funnel.steps[3]?.value ?? 0)} hint={`${percentLabel(funnel.storyRate)} ${tr("of accepted submissions")}`} />
            <Stat label={tr("Articles approved")} value={formatNumber(funnel.steps[5]?.value ?? 0)} hint={`${percentLabel(funnel.approvalRate)} ${tr("of the articles written")}`} />
            <Stat label={tr("Editions")} value={formatNumber(comparison.length)} hint={`${formatNumber(analytics.media.total)} ${tr("pictures in the library")}`} />
          </StatGrid>
        </section>

        <section>
          <SectionTitle>{tr("Who read it")}</SectionTitle>
          <StatGrid columns={4}>
            <Stat
              label={tr("Delivered")}
              value={formatNumber(delivery.delivered)}
              hint={delivery.sent ? `${percentLabel(delivery.deliveryRate)} ${tr("of")} ${formatNumber(delivery.sent)} ${tr("sent")}` : tr("nothing sent in this window")}
            />
            <Stat label={tr("Opened")} value={percentLabel(delivery.openRate)} hint={`${formatNumber(delivery.opened)} ${tr("reader(s)")}`} />
            <Stat label={tr("Clicked")} value={percentLabel(delivery.clickRate)} hint={`${formatNumber(delivery.clicked)} ${tr("reader(s)")}`} />
            <Stat label={tr("Opened, then clicked")} value={percentLabel(delivery.clickThroughRate)} hint={tr("of the people who opened it")} />
          </StatGrid>
          <div className="mt-4">
            <DataTable
              rows={deliveryByEdition}
              rowKey={(row) => row.editionId}
              dense
              empty={{ title: tr("Nothing has been emailed yet"), description: tr("Once an issue goes out, who received it, opened it and clicked is counted here.") }}
              columns={[
                { key: "edition", header: tr("Edition"), cell: (row) => <span className="font-medium">{row.label}</span> },
                { key: "sent", header: tr("Sent"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.sent)}</span>, align: "right" },
                { key: "delivered", header: tr("Delivered"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.delivered)}</span>, align: "right" },
                { key: "opened", header: tr("Opened"), cell: (row) => <span className="tabular text-xs">{percentLabel(row.openRate)}</span>, align: "right" },
                { key: "clicked", header: tr("Clicked"), cell: (row) => <span className="tabular text-xs">{percentLabel(row.clickRate)}</span>, align: "right" },
              ]}
            />
          </div>
        </section>

        <section>
          <SectionTitle>{tr("Rights, issue by issue")}</SectionTitle>
          <DataTable
            rows={rights}
            rowKey={(row) => row.editionId ?? "unassigned"}
            dense
            empty={{ title: tr("No picture yet"), description: tr("Rights appear here once pictures are in the library.") }}
            columns={[
              { key: "edition", header: tr("Edition"), cell: (row) => <span className="font-medium">{row.label}</span> },
              { key: "green", header: tr("Cleared"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.green)}</span>, align: "right" },
              { key: "yellow", header: tr("To check"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.yellow)}</span>, align: "right" },
              { key: "red", header: tr("Refused"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.red)}</span>, align: "right" },
            ]}
          />
        </section>

        <section>
          <SectionTitle>{tr("Their most active contributors")}</SectionTitle>
          <DataTable
            rows={top}
            rowKey={(row) => row.contributorId}
            dense
            empty={{ title: tr("Nobody has contributed yet"), description: tr("Contributors appear once submissions arrive.") }}
            columns={[
              { key: "name", header: tr("Name"), cell: (row) => <span className="font-medium">{row.name}</span> },
              { key: "submissions", header: tr("Submissions"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.submissions)}</span>, align: "right" },
              { key: "accepted", header: tr("Accepted"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.accepted)}</span>, align: "right" },
            ]}
          />
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <SectionTitle>{tr("What it costs to run them")}</SectionTitle>
          <p className="mb-3 text-2xs text-muted-foreground">{tr("Platform only. This half of the page is never shown to the customer.")}</p>
          <StatGrid columns={4}>
            <Stat label={tr("Model calls")} value={formatNumber(costs.aiCalls)} hint={`${formatTokens(costs.aiTokens)} ${tr("tokens")} · ${formatNumber(costs.aiCached)} ${tr("cached")}`} tone={costs.aiFailed ? "warning" : "default"} />
            <Stat label={tr("Model spend")} value={formatCents(costs.aiCents)} hint={`${tr("over")} ${days} ${tr("days")}`} />
            <Stat label={tr("Studio spend")} value={formatCents(costs.creativeCents)} hint={tr("generated pictures and video")} />
            <Stat label={tr("Storage")} value={formatBytes(costs.storageBytes)} hint={tr("originals in the library")} />
          </StatGrid>
          <div className="mt-4">
            <DataTable
              rows={costs.byService}
              rowKey={(row) => row.service}
              dense
              empty={{ title: tr("No AI activity"), description: tr("No AI call was recorded in this window.") }}
              columns={[
                { key: "service", header: tr("Service"), cell: (row) => <span className="font-mono text-xs">{row.service}</span> },
                { key: "calls", header: tr("Calls"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.calls)}</span>, align: "right" },
                { key: "cents", header: tr("Cost"), cell: (row) => <span className="tabular text-xs">{formatCents(row.cents)}</span>, align: "right" },
              ]}
            />
          </div>
        </section>
      </PageBody>
    </>
  );
}
