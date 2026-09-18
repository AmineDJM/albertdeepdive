import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ArrowLeft, Building2, CircleDollarSign, Database, Mail, Receipt, ShieldAlert, Users } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { workspaceSheet, type WorkspaceMember } from "@/server/platform/insights";
import { getSendingDomain } from "@/server/email/domains";
import { overrideReport } from "@/server/platform/overrides";
import { listPlans } from "@/server/billing/plans";
import { LOG_SOURCE_LABELS } from "@/server/platform/logs";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { PLATFORM_TABS } from "@/components/newsroom/nav";
import { DataTable } from "@/components/newsroom/data-table";
import { ProgressBar, Stat, StatGrid } from "@/components/newsroom/stat";
import { Bars } from "@/components/newsroom/bars";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatBytes, formatCents, formatSpend } from "@/lib/format";
import { cn, formatDate, formatNumber, relativeTime } from "@/lib/utils";
import { WorkspaceControls } from "../workspace-controls";
import { WorkspacePlanPicker } from "../workspace-plan-picker";
import { InvoiceControls } from "../../payments/invoice-controls";
import { SubscriptionControls } from "../../payments/subscription-controls";
import { MemberControls } from "./member-controls";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const subscriptionTone = (status: string) => (status === "ACTIVE" || status === "TRIALING" ? "default" : status === "PAST_DUE" || status === "UNPAID" || status === "INCOMPLETE" ? "warning" : "muted");

/**
 * One customer, whole.
 *
 * Who they are, what they pay, what they cost, who works there and what they have been doing —
 * the sheet a support call or a renewal conversation is had from. Every figure is the same query
 * the list and the costs screens use, so the three never disagree about a customer.
 */
export default async function WorkspaceSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Customer")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("This is the platform console. You need to be a Briefly super admin to see it.")}</p>
        </PageBody>
      </>
    );
  }

  const { id } = await params;
  const sheet = await workspaceSheet(id);
  if (!sheet) notFound();
  const [overrides, plans, sendingDomain] = await Promise.all([overrideReport(id), listPlans(true), getSendingDomain(id)]);
  const { organization, subscription, counts, spend30, spendAll } = sheet;
  const currency = subscription.currency;
  const cost30 = spend30.aiCents + spend30.creativeCents;
  const usageLabel: Record<string, string> = { publications: tr("Titles"), users: tr("Members"), subscribers: tr("Subscribers"), editionsPerMonth: tr("Editions this month") };
  const monthPoints = sheet.byMonth.map((month) => ({ label: month.month.slice(2), value: month.aiCents + month.creativeCents, title: `${month.month}: ${formatSpend(month.aiCents + month.creativeCents, currency)} · ${month.emails} ${tr("emails")} · ${month.published} ${tr("published")}` }));
  const stripeLive = sheet.invoices !== null;

  return (
    <>
      <PageHeader
        title={organization.name}
        description={`/${organization.slug} · ${organization.type.toLowerCase()} · ${tr("since")} ${formatDate(organization.createdAt)}`}
        actions={
          <>
            <WorkspacePlanPicker organizationId={id} planId={subscription.planId} plans={plans.map((plan) => ({ id: plan.id, name: plan.name }))} />
            <WorkspaceControls workspace={{ id, name: organization.name, planName: subscription.planName }} overrides={overrides} />
          </>
        }
      >
        <HubTabs tabs={PLATFORM_TABS} />
      </PageHeader>
      <PageBody className="space-y-6">
        <Link href="/platform/workspaces" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />{" "}{tr("All customers")}</Link>

        <StatGrid columns={6}>
          <Stat label={tr("Monthly revenue")} value={subscription.isCustomPriced ? tr("custom") : formatCents(subscription.mrrCents, currency)} hint={`${subscription.planName ?? tr("no plan")} · ${subscription.status.toLowerCase().replace("_", " ")}`} icon={CircleDollarSign} hue="amber" />
          <Stat label={tr("Cost, 30 days")} value={formatSpend(cost30, currency)} hint={`${tr("models")} ${formatSpend(spend30.aiCents, currency)} · ${tr("Studio")} ${formatSpend(spend30.creativeCents, currency)}`} icon={Activity} hue="violet" />
          <Stat label={tr("Margin, 30 days")} value={formatCents(sheet.margin30Cents, currency)} hint={sheet.revenue30Cents ? `${Math.round((sheet.margin30Cents / sheet.revenue30Cents) * 100)}% ${tr("of revenue")}` : tr("nothing billed")} tone={sheet.margin30Cents < 0 ? "destructive" : "default"} hue={sheet.margin30Cents < 0 ? "coral" : "green"} />
          <Stat label={tr("Members")} value={counts.members} hint={`${counts.contributors} ${tr("contributors")}`} icon={Users} hue="teal" />
          <Stat label={tr("Subscribers")} value={formatNumber(counts.subscribers)} hint={counts.payingReaders ? `${counts.payingReaders} ${tr("paying readers")}` : `${counts.publications} ${tr("titles")}`} icon={Mail} hue="cobalt" />
          <Stat label={tr("Storage")} value={formatBytes(spend30.storageBytes)} hint={`${formatNumber(counts.media)} ${tr("files")} · ${formatNumber(spend30.emails)} ${tr("emails, 30 days")}`} icon={Database} hue="magenta" />
        </StatGrid>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-4">
            <SectionTitle>{tr("Customer")}</SectionTitle>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">{tr("Website")}</dt>
              <dd>{organization.website ? <a href={organization.website} target="_blank" rel="noreferrer" className="hover:underline">{organization.website}</a> : "—"}</dd>
              <dt className="text-muted-foreground">{tr("Language")}</dt>
              <dd>{organization.locale} · {organization.timezone}{organization.country ? ` · ${organization.country}` : ""}</dd>
              <dt className="text-muted-foreground">{tr("Onboarded")}</dt>
              <dd>{organization.onboardedAt ? formatDate(organization.onboardedAt) : tr("not finished")}</dd>
              <dt className="text-muted-foreground">{tr("Editions")}</dt>
              <dd>{counts.editions} · {counts.publishedEditions} {tr("published")}{counts.jobsFailed7 ? <span className="text-warning">{" "}· {counts.jobsFailed7} {tr("jobs failed this week")}</span> : null}</dd>
              <dt className="text-muted-foreground">{tr("Email sending")}</dt>
              <dd>{sendingDomain ? <span className="font-mono">{sendingDomain.domainName}</span> : tr("via Briefly (test mode)")}{sendingDomain ? <span className="text-muted-foreground">{" "}· {sendingDomain.status.toLowerCase().replace(/_/g, " ")}</span> : null}</dd>
              <dt className="text-muted-foreground">{tr("Reader payments")}</dt>
              <dd>{organization.readerPaymentsConnected ? `${tr("connected")} · ${counts.paidPublications} ${tr("paid titles")}` : tr("not connected")}</dd>
              <dt className="text-muted-foreground">{tr("All-time cost")}</dt>
              <dd>{formatSpend(spendAll.aiCents + spendAll.creativeCents, currency)} · {formatNumber(spendAll.aiCalls)} {tr("calls")} · {formatNumber(spendAll.emails)} {tr("emails")}</dd>
            </dl>
            {organization.description ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{organization.description}</p> : null}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <SectionTitle action={<SubscriptionControls organizationId={id} stripeCustomerId={subscription.stripeCustomerId} stripeSubscriptionId={subscription.stripeSubscriptionId} livemode={null} />}>{tr("Plan & usage")}</SectionTitle>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium">{subscription.planName ?? tr("No plan")}</span>
              <Badge variant={subscriptionTone(subscription.status)}>{subscription.status.toLowerCase().replace("_", " ")}</Badge>
              {subscription.mrrCents ? <span className="text-muted-foreground">{formatCents(subscription.interval === "year" ? subscription.priceYearlyCents : subscription.priceMonthlyCents, currency)} / {subscription.interval === "year" ? tr("year") : tr("month")}</span> : null}
              {subscription.currentPeriodEnd ? <span className="text-muted-foreground">· {tr("renews")} {formatDate(subscription.currentPeriodEnd)}</span> : null}
              {subscription.cancelAtPeriodEnd ? <Badge variant="warning">{tr("cancels at period end")}</Badge> : null}
              {overrides.rows.some((row) => row.overridden) ? <Badge variant="muted">{overrides.rows.filter((row) => row.overridden).length} {tr("overrides")}</Badge> : null}
            </div>
            <ul className="mt-3 space-y-2">
              {sheet.usage.map((line) => (
                <li key={line.key} className="text-xs">
                  <div className="flex items-center justify-between">
                    <span>{usageLabel[line.key] ?? line.key}</span>
                    <span className="tabular text-muted-foreground">{line.used}{line.limit === null ? ` · ${tr("unlimited")}` : ` / ${line.limit}`}</span>
                  </div>
                  <ProgressBar value={line.limit ? line.used : 0} max={line.limit ?? 1} className="mt-1" hue={line.limit && line.used >= line.limit ? "coral" : "teal"} />
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section>
          <SectionTitle>{tr("Cost by month")}</SectionTitle>
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <Bars points={monthPoints} hue="violet" label={tr("Model and Studio spend per month, last six months")} format={(value) => formatSpend(value, currency)} />
          </div>
        </section>

        <section>
          <SectionTitle>{tr("Members")}</SectionTitle>
          <DataTable
            rows={sheet.members}
            rowKey={(member) => member.userId}
            onRowHref={(member) => `/platform/people/${member.userId}`}
            empty={{ title: tr("Nobody yet"), description: tr("This workspace has no members."), icon: Users }}
            dense
            columns={[
              {
                key: "person",
                header: tr("Person"),
                cell: (member: WorkspaceMember) => (
                  <span className="flex flex-col">
                    <span className="flex items-center gap-2 font-medium">
                      {member.name}
                      {!member.isActive ? <Badge variant="muted">{tr("suspended")}</Badge> : null}
                      {member.platformRole === "SUPER_ADMIN" ? <Badge><ShieldAlert className="size-3" />{" "}{tr("staff")}</Badge> : null}
                    </span>
                    <span className="text-2xs text-muted-foreground">{member.email}</span>
                  </span>
                ),
              },
              { key: "role", header: tr("Workspace role"), cell: (member: WorkspaceMember) => <span className="text-xs capitalize">{member.role.toLowerCase()}</span> },
              { key: "platform", header: tr("Platform role"), cell: (member: WorkspaceMember) => <span className="text-xs text-muted-foreground">{ROLE_LABELS[member.platformRole]}</span> },
              { key: "actions30", header: tr("Actions, 30 days"), cell: (member: WorkspaceMember) => <span className="tabular text-xs">{formatNumber(member.actions30)}</span>, align: "right" },
              { key: "ai30", header: tr("Model calls, 30 days"), cell: (member: WorkspaceMember) => <span className="tabular text-xs">{formatSpend(member.aiCents30, currency)}<span className="text-muted-foreground">{" "}· {member.aiCalls30}</span></span>, align: "right" },
              { key: "seen", header: tr("Last seen"), cell: (member: WorkspaceMember) => <span className="text-2xs text-muted-foreground">{member.lastLoginAt ? relativeTime(member.lastLoginAt) : tr("never")}</span>, align: "right" },
              {
                key: "manage",
                header: "",
                cell: (member: WorkspaceMember) => (
                  <span data-no-row-link>
                    <MemberControls organizationId={id} member={{ userId: member.userId, name: member.name, role: member.role as "OWNER" | "ADMIN" | "EDITOR" | "CONTRIBUTOR" | "VIEWER", platformRole: member.platformRole }} isSelf={member.userId === user?.id} />
                  </span>
                ),
                align: "right",
                width: "60px",
              },
            ]}
          />
        </section>

        <section>
          <SectionTitle>{tr("Invoices")}</SectionTitle>
          {!stripeLive ? (
            <p className="text-xs text-muted-foreground">{subscription.stripeCustomerId ? tr("Stripe is not connected, so this customer’s invoices cannot be read.") : tr("This workspace has never been billed through Stripe.")}</p>
          ) : sheet.invoices?.error ? (
            <p className="text-xs text-warning">{tr("Stripe could not be read just now:")}{" "}{sheet.invoices.error}</p>
          ) : (
            <DataTable
              rows={sheet.invoices?.rows ?? []}
              rowKey={(invoice) => invoice.id}
              empty={{ title: tr("No invoices yet"), description: tr("Stripe has not issued any for this customer."), icon: Receipt }}
              dense
              columns={[
                { key: "number", header: tr("Invoice"), cell: (invoice) => <span className="font-mono text-xs">{invoice.number ?? invoice.id}</span> },
                { key: "date", header: tr("Issued"), cell: (invoice) => <span className="text-xs">{formatDate(invoice.createdAt)}</span> },
                { key: "amount", header: tr("Amount"), cell: (invoice) => <span className="tabular text-xs">{formatCents(invoice.amountDueCents, invoice.currency)}</span>, align: "right" },
                { key: "status", header: tr("Status"), cell: (invoice) => <Badge variant={invoice.status === "paid" ? "success" : invoice.overdue ? "destructive" : invoice.status === "open" ? "warning" : "muted"}>{invoice.overdue && invoice.status === "open" ? tr("overdue") : invoice.status}</Badge> },
                { key: "actions", header: "", cell: (invoice) => <InvoiceControls invoice={{ id: invoice.id, status: invoice.status, hostedUrl: invoice.hostedUrl }} />, align: "right" },
              ]}
            />
          )}
        </section>

        <section>
          <SectionTitle action={<Link href={`/platform/logs?workspace=${id}&days=30`} className="text-xs text-muted-foreground hover:text-foreground">{tr("All logs")}</Link>}>{tr("Activity, 30 days")}</SectionTitle>
          {sheet.activity.length ? (
            <ol className="divide-y divide-border rounded-lg border border-border bg-card">
              {sheet.activity.map((entry) => (
                <li key={`${entry.source}-${entry.id}`} className={cn("flex items-start gap-3 px-3 py-2 text-xs", entry.failed && "bg-destructive/5")}>
                  <span className="mt-0.5 w-20 shrink-0 text-2xs text-muted-foreground">{relativeTime(entry.at)}</span>
                  <Badge variant={entry.failed ? "destructive" : "muted"} className="shrink-0">{LOG_SOURCE_LABELS[entry.source]}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{entry.action}</span>
                    {entry.actor ? <span className="text-muted-foreground">{" "}· {entry.actor}</span> : null}
                    {entry.subject ? <span className="text-muted-foreground">{" "}· {entry.subject}</span> : null}
                    {entry.detail ? <span className="block truncate text-2xs text-muted-foreground">{entry.detail}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-muted-foreground">{tr("Nothing in the last thirty days.")}</p>
          )}
        </section>

        <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          <Building2 className="size-3" />{" "}{tr("Workspace id")}{" "}<span className="font-mono">{id}</span>
        </p>
      </PageBody>
    </>
  );
}
