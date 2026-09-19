import Link from "next/link";
import { BarChart3, Building2, Mail, MousePointerClick, Send } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { editionsByWorkspace, platformTotals, workspaceAnalyticsRows, type WorkspaceAnalyticsRow } from "@/server/platform/analytics";
import { percentLabel } from "@/server/analytics/compute";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Bars } from "@/components/newsroom/bars";
import { formatBytes } from "@/lib/format";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const WINDOWS = [7, 30, 90] as const;
const windowOf = (raw: string | string[] | undefined): number => {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return (WINDOWS as readonly number[]).includes(value) ? value : 30;
};

/**
 * Every customer's figures, which is the one view the rest of the product refuses to give.
 *
 * A customer's own Analytics page cannot see past its workspace — that is enforced in the type its
 * queries take, not in what the page chooses to render. This screen is the deliberate other half:
 * platform totals, one row per customer, and a link into each customer's own numbers. It reads
 * `server/platform/analytics`, whose queries are written to cross workspaces and are used nowhere
 * else.
 */
export default async function PlatformAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Platform analytics")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Reading every customer's figures is a platform job. You need to be a Briefly super admin.")}</p>
        </PageBody>
      </>
    );
  }

  const days = windowOf((await searchParams).days);
  const [totals, rows, volume] = await Promise.all([platformTotals(days), workspaceAnalyticsRows(days), editionsByWorkspace(90)]);
  const busiest = [...rows].sort((a, b) => b.storageBytes - a.storageBytes).slice(0, 8);

  return (
    <>
      <PageHeader
        title={tr("Platform analytics")}
        description={tr("Every workspace, added up and side by side: what they publish, who reads it, and how much room they take.")}
      />
      <PageBody className="space-y-6">
        <div className="flex items-center gap-1" role="group" aria-label={tr("Window")}>
          {WINDOWS.map((window) => (
            <Link
              key={window}
              href={`/admin/analytics?days=${window}`}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                window === days ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {window} {tr("days")}
            </Link>
          ))}
        </div>

        <section>
          <SectionTitle>{tr("The platform")}</SectionTitle>
          <StatGrid columns={4}>
            <Stat label={tr("Workspaces")} value={formatNumber(totals.workspaces)} hint={`${formatNumber(totals.activeWorkspaces)} ${tr("active in this window")}`} />
            <Stat label={tr("Publications")} value={formatNumber(totals.publications)} hint={`${formatNumber(totals.editions)} ${tr("editions")} · ${formatNumber(totals.publishedEditions)} ${tr("published")}`} />
            <Stat label={tr("Submissions")} value={formatNumber(totals.submissions)} hint={tr("received in this window")} />
            <Stat label={tr("Recipients")} value={formatNumber(totals.recipients)} hint={tr("confirmed subscribers")} />
          </StatGrid>
        </section>

        <section>
          <SectionTitle>{tr("Reach across every customer")}</SectionTitle>
          <StatGrid columns={4}>
            <Stat
              label={tr("Delivered")}
              value={formatNumber(totals.reach.delivered)}
              hint={totals.reach.sent ? `${percentLabel(totals.reach.deliveryRate)} ${tr("of")} ${formatNumber(totals.reach.sent)} ${tr("sent")} · ${formatNumber(totals.reach.bounced)} ${tr("bounced")}` : tr("nothing sent in this window")}
              tone={totals.reach.bounced ? "warning" : "default"}
            />
            <Stat label={tr("Opened")} value={percentLabel(totals.reach.openRate)} hint={`${formatNumber(totals.reach.opened)} ${tr("reader(s)")}`} />
            <Stat label={tr("Clicked")} value={percentLabel(totals.reach.clickRate)} hint={`${formatNumber(totals.reach.clicked)} ${tr("reader(s)")}`} />
            <Stat label={tr("Opened, then clicked")} value={percentLabel(totals.reach.clickThroughRate)} hint={tr("of the people who opened it")} />
          </StatGrid>
        </section>

        <section>
          <SectionTitle>{tr("Every customer")}</SectionTitle>
          <DataTable
            rows={rows}
            rowKey={(row: WorkspaceAnalyticsRow) => row.id}
            dense
            empty={{ title: tr("No workspace yet"), description: tr("Customers appear here as soon as they sign up.") }}
            columns={[
              {
                key: "name",
                header: tr("Workspace"),
                cell: (row) => (
                  <Link href={`/admin/analytics/${row.id}?days=${days}`} className="font-medium hover:underline">
                    {row.name}
                  </Link>
                ),
              },
              { key: "plan", header: tr("Plan"), cell: (row) => <span className="text-xs text-muted-foreground">{row.planName ?? tr("Free")}</span> },
              { key: "users", header: tr("Users"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.users)}</span>, align: "right" },
              { key: "publications", header: tr("Publications"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.publications)}</span>, align: "right" },
              { key: "editions", header: tr("Editions"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.editions)}</span>, align: "right" },
              { key: "submissions", header: tr("Submissions"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.submissions)}</span>, align: "right" },
              { key: "delivered", header: tr("Delivered"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.reach.delivered)}</span>, align: "right" },
              { key: "opened", header: tr("Opened"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.reach.opened)}</span>, align: "right" },
              { key: "clicked", header: tr("Clicked"), cell: (row) => <span className="tabular text-xs">{formatNumber(row.reach.clicked)}</span>, align: "right" },
              { key: "openRate", header: tr("Open rate"), cell: (row) => <span className="tabular text-xs">{row.reach.delivered ? percentLabel(row.reach.openRate) : "—"}</span>, align: "right" },
              { key: "storage", header: tr("Storage"), cell: (row) => <span className="tabular text-xs text-muted-foreground">{formatBytes(row.storageBytes)}</span>, align: "right" },
              {
                key: "lastActivity",
                header: tr("Last activity"),
                cell: (row) => <span className="text-xs text-muted-foreground">{row.lastActivity ? formatDate(row.lastActivity) : "—"}</span>,
                align: "right",
              },
            ]}
          />
        </section>

        <div className="grid gap-4 xl:grid-cols-2">
          <section>
            <SectionTitle>{tr("Editions made, last 90 days")}</SectionTitle>
            <Bars
              points={volume.slice(0, 8).map((row) => ({ label: row.name, value: row.editions, title: `${row.name}: ${row.editions} ${tr("editions")}, ${row.published} ${tr("published")}` }))}
              hue="violet"
              label={tr("Editions created per customer over the last ninety days")}
            />
          </section>
          <section>
            <SectionTitle>{tr("Storage by customer")}</SectionTitle>
            <Bars
              points={busiest.map((row) => ({ label: row.name, value: row.storageBytes, title: `${row.name}: ${formatBytes(row.storageBytes)}` }))}
              hue="teal"
              label={tr("Stored bytes per customer, originals and every variant")}
              format={(value) => formatBytes(value)}
            />
            <p className="mt-2 text-2xs text-muted-foreground">
              {tr("Total")}: {formatBytes(totals.storageBytes)}
            </p>
          </section>
        </div>

        <section className="flex flex-wrap gap-3 text-2xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Building2 className="size-3" /> {tr("A customer never sees another customer's figures — their queries cannot be written without a workspace.")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Send className="size-3" /> {tr("Delivery is counted from Briefly's own log, not a provider dashboard.")}
          </span>
          <span className="inline-flex items-center gap-1">
            <MousePointerClick className="size-3" /> {tr("Rates are against what was delivered, because a bounced address never had the chance to open it.")}
          </span>
          <span className="inline-flex items-center gap-1">
            <Mail className="size-3" /> <Link href="/admin/costs" className="underline">{tr("Usage & costs")}</Link>
          </span>
          <span className="inline-flex items-center gap-1">
            <BarChart3 className="size-3" /> <Link href="/admin/organizations" className="underline">{tr("Organizations")}</Link>
          </span>
        </section>
      </PageBody>
    </>
  );
}
