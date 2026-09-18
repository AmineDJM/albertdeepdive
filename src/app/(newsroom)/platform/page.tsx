import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, CircleDollarSign, Cpu, Mail, Plug, Sparkles, Users, Zap } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { dormantWorkspaces, platformHealth, recentFailures } from "@/server/platform/dashboard";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { PLATFORM_TABS } from "@/components/newsroom/nav";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { DataTable } from "@/components/newsroom/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatNumber, relativeTime } from "@/lib/utils";
import { Housekeeping } from "./housekeeping";

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
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title="Platform" />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">This is the platform console. You need to be a Briefly super admin to see it.</p>
        </PageBody>
      </>
    );
  }

  const [health, failures, dormant] = await Promise.all([platformHealth(), recentFailures(12), dormantWorkspaces()]);
  const missing = health.integrations.filter((integration) => !integration.configured);
  const problems = health.reliability.jobsFailed24 + health.reliability.emailsFailed24 + health.reliability.aiErrors24;

  return (
    <>
      <PageHeader title="Platform" description="Every customer on this Briefly, and how it is holding up.">
        <HubTabs tabs={PLATFORM_TABS} />
      </PageHeader>
      <PageBody className="space-y-6">
        <StatGrid columns={4}>
          <Stat label="Monthly recurring" value={money(health.revenue.mrrCents)} hint={`${health.revenue.payingWorkspaces} paying · ${health.revenue.freeWorkspaces} free`} icon={CircleDollarSign} hue="amber" href="/platform/workspaces" />
          <Stat label="Workspaces" value={formatNumber(health.growth.workspacesTotal)} hint={`${health.growth.workspacesNew30} in the last 30 days`} icon={Users} hue="teal" href="/platform/workspaces" />
          <Stat label="Published, 30 days" value={formatNumber(health.activity.publishedEditions30)} hint={`${formatNumber(health.activity.emailsSent30)} emails sent`} icon={Sparkles} hue="violet" />
          <Stat
            label="AI spend, 30 days"
            value={money(health.spend.aiCostCents30)}
            hint={`${money(health.spend.costPerWorkspaceCents)} per workspace · ${formatNumber(health.spend.aiCalls30)} calls`}
            icon={Cpu}
            hue={health.spend.costPerWorkspaceCents > 500 ? "coral" : "green"}
          />
        </StatGrid>

        {missing.length ? (
          <section className="rounded-xl border border-amber-soft bg-amber-soft/50 p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber text-white">
                <Plug className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-semibold">
                  {missing.length} service{missing.length === 1 ? "" : "s"} not connected
                </h2>
                <ul className="mt-2 space-y-1">
                  {missing.map((integration) => (
                    <li key={integration.key} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{integration.name}</span> — {integration.whenMissing}
                    </li>
                  ))}
                </ul>
                <Button asChild size="sm" className="mt-3">
                  <Link href="/platform/integrations">
                    Connect them <ArrowRight />
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
            Every service is connected. Payments, sending, models and storage are all live.
          </section>
        )}

        <div className="grid gap-4 xl:grid-cols-2">
          <section>
            <SectionTitle action={problems ? <Badge variant="muted">{problems} in 24h</Badge> : null}>What is failing</SectionTitle>
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
                  Nothing has failed in the last two days. {health.reliability.jobsQueued} job{health.reliability.jobsQueued === 1 ? "" : "s"} queued,{" "}
                  {health.reliability.jobsRunning} running.
                </p>
              )}
            </div>
          </section>

          <section>
            <SectionTitle action={dormant.length ? <Badge variant="muted">{dormant.length}</Badge> : null}>Gone quiet</SectionTitle>
            <div className="rounded-lg border border-border bg-card">
              {dormant.length ? (
                <ul className="divide-y divide-border">
                  {dormant.slice(0, 8).map((workspace) => (
                    <li key={workspace.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{workspace.name}</span>
                        <span className="block truncate text-2xs text-muted-foreground">
                          {workspace.planName ?? "Free"} · {workspace.editions} edition{workspace.editions === 1 ? "" : "s"} · last seen{" "}
                          {workspace.lastActivity ? relativeTime(workspace.lastActivity) : "never"}
                        </span>
                      </span>
                      <Button asChild variant="ghost" size="xs">
                        <Link href={`/platform/workspaces?open=${workspace.id}`}>Open</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3.5 py-8 text-center text-xs text-muted-foreground">
                  Every workspace that has published has been active in the last three weeks.
                </p>
              )}
            </div>
          </section>
        </div>

        <section>
          <SectionTitle action={<Button asChild variant="ghost" size="xs"><Link href="/platform/workspaces">All customers <ArrowRight /></Link></Button>}>Plans</SectionTitle>
          <DataTable
            rows={health.plans}
            rowKey={(row) => row.planKey}
            empty={{ title: "No plans", description: "Plans are seeded on migration.", icon: CircleDollarSign }}
            columns={[
              { key: "plan", header: "Plan", cell: (row) => <span className="font-medium">{row.planName}</span> },
              { key: "price", header: "Monthly", cell: (row) => <span className="tabular">{row.isCustomPriced ? "Custom" : row.priceMonthlyCents ? money(row.priceMonthlyCents) : "Free"}</span>, align: "right" },
              { key: "workspaces", header: "Workspaces", cell: (row) => <span className="tabular">{row.workspaces}</span>, align: "right" },
              { key: "paying", header: "Paying", cell: (row) => <span className="tabular">{row.paying}</span>, align: "right" },
              {
                key: "mrr",
                header: "Contributes",
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
                {health.revenue.pastDue} workspace{health.revenue.pastDue === 1 ? "" : "s"} past due — still working while Stripe retries.
              </span>
            ) : null}
            {health.revenue.trialing ? (
              <span className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-violet" />
                {health.revenue.trialing} on trial.
              </span>
            ) : null}
          </section>
        ) : null}

        <section>
          <SectionTitle>Housekeeping</SectionTitle>
          <Housekeeping />
        </section>
      </PageBody>
    </>
  );
}
