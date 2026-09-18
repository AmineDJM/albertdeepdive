import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, CircleDollarSign, Cpu, Mail, Plug, Sparkles, Users, Zap } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { dormantWorkspaces, platformHealth, recentFailures } from "@/server/platform/dashboard";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { DataTable } from "@/components/newsroom/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, relativeTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const money = (cents: number, currency = "EUR") => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);

/**
 * Running Briefly, on one screen.
 *
 * Four questions, in the order somebody asks them: is it making money, is anyone using it, is it
 * broken, and is it about to cost more than it earns. Everything below that is something to act on —
 * a service that is not connected, a customer who has gone quiet, an error from the last two days.
 *
 * Nothing here is a vanity figure. If a number cannot change what the reader does next, it is not on
 * this page.
 */
export default async function PlatformHealthPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Platform")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("This is the platform console. You need to be a Briefly super admin to see it.")}</p>
        </PageBody>
      </>
    );
  }

  const [health, failures, dormant] = await Promise.all([platformHealth(), recentFailures(12), dormantWorkspaces()]);
  const missing = health.integrations.filter((integration) => !integration.configured);
  const problems = health.reliability.jobsFailed24 + health.reliability.emailsFailed24 + health.reliability.aiErrors24;

  return (
    <>
      <PageHeader title={tr("Overview")} description={tr("Every customer on this Briefly, and how it is holding up.")} />
      <PageBody className="space-y-6">
        <StatGrid columns={6}>
          <Stat label={tr("Monthly recurring")} value={money(health.revenue.mrrCents)} hint={`${health.revenue.payingWorkspaces} ${tr("paying")} · ${health.revenue.freeWorkspaces} ${tr("free")}`} icon={CircleDollarSign} hue="amber" href="/admin/billing" />
          <Stat label={tr("Annual run rate")} value={money(health.revenue.mrrCents * 12)} hint={health.revenue.trialing ? `${health.revenue.trialing} ${tr("on trial")}` : tr("no trials running")} hue="amber" href="/admin/plans" />
          <Stat label={tr("Organizations")} value={formatNumber(health.growth.workspacesTotal)} hint={`${health.growth.workspacesNew30} ${tr("new in 30 days")}`} icon={Users} hue="teal" href="/admin/organizations" />
          <Stat label={tr("Subscribers managed")} value={formatNumber(health.growth.subscribersTotal)} hint={`${formatNumber(health.activity.emailsSent30)} ${tr("emails sent, 30 days")}`} hue="teal" href="/admin/organizations" />
          <Stat label={tr("Published, 30 days")} value={formatNumber(health.activity.publishedEditions30)} hint={`${formatNumber(health.activity.editions30)} ${tr("editions started")}`} icon={Sparkles} hue="violet" />
          <Stat label={tr("AI spend, 30 days")} value={money(health.spend.aiCostCents30)} hint={`${money(health.spend.costPerWorkspaceCents)} ${tr("per organization")}`} icon={Cpu} hue={health.spend.costPerWorkspaceCents > 500 ? "coral" : "green"} href="/admin/costs" />
        </StatGrid>

        <section>
          <SectionTitle>{tr("Platform health")}</SectionTitle>
          <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: tr("Email delivery"), ok: health.reliability.emailsFailed24 === 0, detail: health.reliability.emailsFailed24 ? `${health.reliability.emailsFailed24} ${tr("failed in 24h")}` : tr("Operational"), href: "/admin/audit?source=email&failures=1" },
              { label: tr("Background jobs"), ok: health.reliability.jobsFailed24 === 0, warn: health.reliability.jobsQueued > 25, detail: health.reliability.jobsFailed24 ? `${health.reliability.jobsFailed24} ${tr("failed in 24h")}` : health.reliability.jobsQueued > 25 ? `${tr("Elevated queue")} · ${health.reliability.jobsQueued}` : `${tr("Operational")} · ${health.reliability.jobsQueued} ${tr("queued")}`, href: "/admin/jobs" },
              { label: tr("Models"), ok: health.reliability.aiErrors24 === 0, detail: health.reliability.aiErrors24 ? `${health.reliability.aiErrors24} ${tr("errors in 24h")}` : tr("Operational"), href: "/admin/costs" },
              { label: tr("Providers"), ok: missing.length === 0, warn: missing.length > 0, detail: missing.length ? `${missing.length} ${tr("not connected")}` : tr("All connected"), href: "/admin/providers" },
            ].map((row) => (
              <Link key={row.label} href={row.href} className="flex items-center justify-between gap-3 bg-card px-4 py-3 transition-colors duration-150 hover:bg-muted/40">
                <dt className="text-[13px] font-medium">{row.label}</dt>
                <dd className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={`size-2 rounded-full ${row.ok && !row.warn ? "bg-success" : row.ok ? "bg-warning" : "bg-destructive"}`} />
                  {row.detail}
                </dd>
              </Link>
            ))}
          </dl>
        </section>

        {missing.length ? (
          <section className="rounded-xl border border-amber-soft bg-amber-soft/50 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber text-white">
                <Plug className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold">
                  {missing.length}{" "}{tr("service")}{missing.length === 1 ? "" : "s"}{" "}{tr("not connected")}</h2>
                <ul className="mt-2 space-y-1">
                  {missing.map((integration) => (
                    <li key={integration.key} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{integration.name}</span> — {integration.whenMissing}
                    </li>
                  ))}
                </ul>
                <Button asChild size="sm" className="mt-3">
                  <Link href="/admin/providers">
                    {tr("Connect them")}{" "}<ArrowRight />
                  </Link>
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <section className="flex items-center gap-2.5 rounded-xl border border-green-soft bg-green-soft/50 px-4 py-3 text-[13px]">
            <span className="flex size-5 items-center justify-center rounded-full bg-green text-white">
              <Check className="size-3" />
            </span>
            {tr("Every service is connected. Payments, sending, models and storage are all live.")}</section>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <section>
            <SectionTitle action={problems ? <Badge variant="muted">{problems}{" "}{tr("in 24h")}</Badge> : null}>{tr("What is failing")}</SectionTitle>
            <div className="rounded-lg border border-border bg-card">
              {failures.length ? (
                <ul className="divide-y divide-border">
                  {failures.map((failure) => (
                    <li key={failure.id} className="flex items-start gap-3 px-3.5 py-2.5">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-coral-soft text-coral-deep">
                        {failure.source === "Email" ? <Mail className="size-3" /> : failure.source === "AI" ? <Cpu className="size-3" /> : <Zap className="size-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-[13px] font-medium">{failure.kind || failure.source}</span>
                          <span className="shrink-0 text-2xs text-muted-foreground">{relativeTime(failure.at)}</span>
                        </span>
                        <span className="line-clamp-2 block text-xs text-muted-foreground">{failure.detail || "No message recorded."}</span>
                        {failure.workspace ? <span className="mt-0.5 block text-2xs text-muted-foreground">{failure.workspace}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3.5 py-8 text-center text-xs text-muted-foreground">
                  {tr("Nothing has failed in the last two days.")}{" "}{health.reliability.jobsQueued}{" "}{tr("job")}{health.reliability.jobsQueued === 1 ? "" : "s"}{" "}{tr("queued,")}{" "}
                  {health.reliability.jobsRunning}{" "}{tr("running.")}</p>
              )}
            </div>
          </section>

          <section>
            <SectionTitle action={dormant.length ? <Badge variant="muted">{dormant.length}</Badge> : null}>{tr("Gone quiet")}</SectionTitle>
            <div className="rounded-lg border border-border bg-card">
              {dormant.length ? (
                <ul className="divide-y divide-border">
                  {dormant.slice(0, 8).map((workspace) => (
                    <li key={workspace.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{workspace.name}</span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {workspace.planName ?? "Free"} · {workspace.editions}{" "}{tr("edition")}{workspace.editions === 1 ? "" : "s"}{" "}{tr("· last seen")}{" "}
                          {workspace.lastActivity ? relativeTime(workspace.lastActivity) : "never"}
                        </span>
                      </span>
                      <Button asChild variant="ghost" size="xs">
                        <Link href={`/admin/organizations?open=${workspace.id}`}>{tr("Open")}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3.5 py-8 text-center text-xs text-muted-foreground">
                  {tr("Every workspace that has published has been active in the last three weeks.")}</p>
              )}
            </div>
          </section>
        </div>

        <section>
          <SectionTitle action={<Button asChild variant="ghost" size="xs"><Link href="/admin/organizations">{tr("All customers")}{" "}<ArrowRight /></Link></Button>}>{tr("Plans")}</SectionTitle>
          <DataTable
            rows={health.plans}
            rowKey={(row) => row.planKey}
            empty={{ title: tr("No plans"), description: tr("Plans are seeded on migration."), icon: CircleDollarSign }}
            columns={[
              { key: "plan", header: tr("Plan"), cell: (row) => <span className="font-medium">{row.planName}</span> },
              { key: "price", header: tr("Monthly"), cell: (row) => <span className="tabular">{row.isCustomPriced ? "Custom" : row.priceMonthlyCents ? money(row.priceMonthlyCents) : "Free"}</span>, align: "right" },
              { key: "workspaces", header: tr("Workspaces"), cell: (row) => <span className="tabular">{row.workspaces}</span>, align: "right" },
              { key: "paying", header: tr("Paying"), cell: (row) => <span className="tabular">{row.paying}</span>, align: "right" },
              {
                key: "mrr",
                header: tr("Contributes"),
                cell: (row) => <span className="tabular font-medium">{money(row.paying * row.priceMonthlyCents)}</span>,
                align: "right",
              },
            ]}
          />
        </section>

        {health.revenue.pastDue || health.revenue.trialing ? (
          <section className="flex flex-wrap gap-4 rounded-lg border border-border bg-card px-4 py-3 text-[13px]">
            {health.revenue.pastDue ? (
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-3.5 text-coral" />
                {health.revenue.pastDue}{" "}{tr("workspace")}{health.revenue.pastDue === 1 ? "" : "s"}{" "}{tr("past due — still working while Stripe retries.")}</span>
            ) : null}
            {health.revenue.trialing ? (
              <span className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-violet" />
                {health.revenue.trialing}{" "}{tr("on trial.")}</span>
            ) : null}
          </section>
        ) : null}
      </PageBody>
    </>
  );
}
