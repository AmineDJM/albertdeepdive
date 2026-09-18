import Link from "next/link";
import { AudioLines, Cpu, Database, Download, Mail, Sparkles, TrendingUp, Users } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { COST_WINDOWS, costWindow, costsBreakdown, type ModelSpend, type PersonSpend, type ServiceSpend, type WorkspaceSpend } from "@/server/platform/insights";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { PLATFORM_TABS } from "@/components/newsroom/nav";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Bars } from "@/components/newsroom/bars";
import { Button } from "@/components/ui/button";
import { formatBytes, formatCents, formatSpend, formatTokens } from "@/lib/format";
import { cn, formatNumber } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * What running the platform costs, and who it is spent on.
 *
 * Four cuts of the same ledgers — by customer, by person, by model, by day — against what the
 * customers pay for the same days. The margin per customer is the number this screen exists for:
 * a workspace whose model calls cost more than its plan is either a pricing mistake or a customer
 * to talk to, and either way somebody should know.
 */
export default async function PlatformCostsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Costs")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Reading what every customer costs is a platform job. You need to be a Briefly super admin.")}</p>
        </PageBody>
      </>
    );
  }

  const days = costWindow((await searchParams).days);
  const breakdown = await costsBreakdown(days);
  const { totals } = breakdown;
  const currency = breakdown.byWorkspace.find((row) => row.mrrCents > 0)?.currency ?? "EUR";
  const margin = totals.marginCents;
  const points = breakdown.byDay.map((day) => ({ label: day.day.slice(5), value: day.aiCents + day.creativeCents + day.speechCents, title: `${day.day}: ${formatSpend(day.aiCents + day.creativeCents + day.speechCents, currency)} · ${day.calls} ${tr("calls")}` }));

  return (
    <>
      <PageHeader
        title={tr("Costs")}
        description={tr("Model calls, generated pictures, email and storage — by customer, by person, by model — against what the plans bring in.")}
        actions={
          <Button variant="outline" size="sm" asChild>
            <a href={`/platform/costs/export?days=${days}`}>
              <Download />{" "}{tr("Export CSV")}</a>
          </Button>
        }
      >
        <HubTabs tabs={PLATFORM_TABS} />
      </PageHeader>
      <PageBody className="space-y-6">
        <div className="flex items-center gap-1" role="group" aria-label={tr("Window")}>
          {COST_WINDOWS.map((window) => (
            <Link
              key={window}
              href={`/platform/costs?days=${window}`}
              aria-current={window === days ? "page" : undefined}
              className={cn("rounded-md border px-2.5 py-1 text-xs font-medium transition-colors", window === days ? "border-brand bg-brand/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {window}{" "}{tr("days")}
            </Link>
          ))}
        </div>

        <StatGrid columns={4}>
          <Stat label={tr("Revenue")} value={formatCents(totals.revenueCents, currency)} hint={`${tr("over")} ${days} ${tr("days, from the plans")}`} icon={TrendingUp} hue="amber" />
          <Stat label={tr("Model calls")} value={formatSpend(totals.aiCents, currency)} hint={`${formatNumber(totals.aiCalls)} ${tr("calls")} · ${formatTokens(totals.aiTokens)} ${tr("tokens")}${totals.aiFailed ? ` · ${totals.aiFailed} ${tr("failed")}` : ""}`} icon={Cpu} hue="violet" />
          <Stat label={tr("Studio")} value={formatSpend(totals.creativeCents, currency)} hint={`${formatNumber(totals.creativeCredits)} ${tr("credits")}`} icon={Sparkles} hue="magenta" />
          <Stat label={tr("Narration")} value={formatSpend(totals.speechCents, currency)} hint={`${formatNumber(Math.round(totals.speechSeconds / 60))} ${tr("minutes of audio")}`} icon={AudioLines} hue="violet" />
          <Stat label={tr("Margin")} value={formatCents(margin, currency)} hint={totals.revenueCents ? `${Math.round((margin / totals.revenueCents) * 100)}% ${tr("of revenue")}` : tr("nothing billed yet")} tone={margin < 0 ? "destructive" : "default"} hue={margin < 0 ? "coral" : "green"} />
          <Stat label={tr("Emails sent")} value={formatNumber(totals.emails)} hint={totals.emailsFailed ? `${totals.emailsFailed} ${tr("failed")}` : tr("none failed")} icon={Mail} hue="teal" />
          <Stat label={tr("Storage")} value={formatBytes(totals.storageBytes)} hint={tr("held now, all customers")} icon={Database} hue="cobalt" />
        </StatGrid>

        <section>
          <SectionTitle>{tr("Spend by day")}</SectionTitle>
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <Bars points={points} hue="violet" label={`${tr("Model, Studio and narration spend per day over the last")} ${days} ${tr("days")}`} format={(value) => formatSpend(value, currency)} />
          </div>
        </section>

        <section>
          <SectionTitle>{tr("By customer")}</SectionTitle>
          {totals.unattributedAiCents > 0 ? <p className="mb-2 text-xs text-muted-foreground">{formatSpend(totals.unattributedAiCents, currency)}{" "}{tr("of model spend belongs to no workspace: platform-level calls, or calls older than tenancy.")}</p> : null}
          <DataTable
            rows={breakdown.byWorkspace}
            rowKey={(row) => row.organizationId}
            onRowHref={(row) => `/platform/workspaces/${row.organizationId}`}
            empty={{ title: tr("No workspaces"), description: tr("The first one is created by onboarding."), icon: Users }}
            dense
            columns={[
              {
                key: "workspace",
                header: tr("Workspace"),
                cell: (row: WorkspaceSpend) => (
                  <span className="flex flex-col">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-2xs text-muted-foreground">{row.planName ?? tr("no plan")} · {row.status.toLowerCase().replace("_", " ")}</span>
                  </span>
                ),
              },
              { key: "revenue", header: tr("Revenue"), cell: (row: WorkspaceSpend) => <span className="tabular text-xs">{formatCents(row.revenueCents, row.currency)}</span>, align: "right" },
              { key: "ai", header: tr("Model calls"), cell: (row: WorkspaceSpend) => <span className="tabular text-xs">{formatSpend(row.aiCents, row.currency)}<span className="text-muted-foreground">{" "}· {formatNumber(row.aiCalls)}</span></span>, align: "right" },
              { key: "creative", header: tr("Studio"), cell: (row: WorkspaceSpend) => <span className="tabular text-xs">{formatSpend(row.creativeCents, row.currency)}</span>, align: "right" },
              { key: "speech", header: tr("Narration"), cell: (row: WorkspaceSpend) => <span className="tabular text-xs">{formatSpend(row.speechCents, row.currency)}<span className="text-muted-foreground">{" "}· {formatNumber(Math.round(row.speechSeconds / 60))} min</span></span>, align: "right" },
              { key: "emails", header: tr("Emails"), cell: (row: WorkspaceSpend) => <span className="tabular text-xs">{formatNumber(row.emails)}{row.emailsFailed ? <span className="text-warning">{" "}· {row.emailsFailed} ✕</span> : null}</span>, align: "right" },
              { key: "storage", header: tr("Storage"), cell: (row: WorkspaceSpend) => <span className="tabular text-xs">{formatBytes(row.storageBytes)}</span>, align: "right" },
              { key: "margin", header: tr("Margin"), cell: (row: WorkspaceSpend) => <span className={cn("tabular text-xs font-medium", row.marginCents < 0 ? "text-destructive" : "")}>{formatCents(row.marginCents, row.currency)}</span>, align: "right" },
            ]}
          />
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <section>
            <SectionTitle>{tr("By person")}</SectionTitle>
            <DataTable
              rows={breakdown.byPerson}
              rowKey={(row) => row.userId}
              onRowHref={(row) => `/platform/people/${row.userId}`}
              empty={{ title: tr("Nothing attributed"), description: tr("Calls are written to the person who asked, from now on."), icon: Users }}
              dense
              columns={[
                {
                  key: "person",
                  header: tr("Person"),
                  cell: (row: PersonSpend) => (
                    <span className="flex flex-col">
                      <span className="font-medium">{row.name}</span>
                      <span className="text-2xs text-muted-foreground">{row.workspaces.join(", ") || row.email}</span>
                    </span>
                  ),
                },
                { key: "ai", header: tr("Model calls"), cell: (row: PersonSpend) => <span className="tabular text-xs">{formatSpend(row.aiCents, currency)}<span className="text-muted-foreground">{" "}· {formatNumber(row.aiCalls)}</span></span>, align: "right" },
                { key: "creative", header: tr("Studio"), cell: (row: PersonSpend) => <span className="tabular text-xs">{formatSpend(row.creativeCents, currency)}</span>, align: "right" },
              ]}
            />
          </section>
          <section>
            <SectionTitle>{tr("By model")}</SectionTitle>
            <DataTable
              rows={breakdown.byModel}
              rowKey={(row) => `${row.provider}/${row.model}`}
              empty={{ title: tr("No model calls"), description: tr("Nothing was asked of a model in this window."), icon: Cpu }}
              dense
              columns={[
                { key: "model", header: tr("Model"), cell: (row: ModelSpend) => <span className="flex flex-col"><span className="font-mono text-xs">{row.model}</span><span className="text-2xs text-muted-foreground">{row.provider}</span></span> },
                { key: "calls", header: tr("Calls"), cell: (row: ModelSpend) => <span className="tabular text-xs">{formatNumber(row.calls)}{row.failed ? <span className="text-warning">{" "}· {row.failed} ✕</span> : null}</span>, align: "right" },
                { key: "tokens", header: tr("Tokens"), cell: (row: ModelSpend) => <span className="tabular text-xs">{formatTokens(row.tokens)}</span>, align: "right" },
                { key: "cost", header: tr("Cost"), cell: (row: ModelSpend) => <span className="tabular text-xs">{formatSpend(row.cents, currency)}</span>, align: "right" },
              ]}
            />
            <div className="mt-4">
              <SectionTitle>{tr("By task")}</SectionTitle>
              <DataTable
                rows={breakdown.byService}
                rowKey={(row) => row.service}
                empty={{ title: tr("No tasks"), description: tr("Nothing ran in this window."), icon: Cpu }}
                dense
                columns={[
                  { key: "service", header: tr("Task"), cell: (row: ServiceSpend) => <span className="font-mono text-xs">{row.service}</span> },
                  { key: "calls", header: tr("Calls"), cell: (row: ServiceSpend) => <span className="tabular text-xs">{formatNumber(row.calls)}</span>, align: "right" },
                  { key: "cost", header: tr("Cost"), cell: (row: ServiceSpend) => <span className="tabular text-xs">{formatSpend(row.cents, currency)}</span>, align: "right" },
                ]}
              />
            </div>
          </section>
        </div>
      </PageBody>
    </>
  );
}
