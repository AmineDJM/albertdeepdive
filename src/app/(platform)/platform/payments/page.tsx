import Link from "next/link";
import { AlertTriangle, CalendarClock, CircleDollarSign, Receipt, Wallet } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { paymentsOverview, type InvoiceRow, type SubscriptionRow } from "@/server/platform/payments";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { PLATFORM_TABS } from "@/components/newsroom/nav";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { formatCents } from "@/lib/format";
import { formatDate, relativeTime } from "@/lib/utils";
import { InvoiceControls } from "./invoice-controls";
import { SubscriptionControls } from "./subscription-controls";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const subscriptionTone = (status: string) => (status === "ACTIVE" || status === "TRIALING" ? "default" : status === "PAST_DUE" || status === "UNPAID" || status === "INCOMPLETE" ? "warning" : "muted");
const invoiceTone = (invoice: InvoiceRow) => (invoice.status === "paid" ? "success" : invoice.overdue ? "destructive" : invoice.status === "open" ? "warning" : "muted");

/**
 * Money, on one screen: what comes in every month, what has been collected, what is owed, and the
 * three things to do about an invoice nobody paid. The database side is always here; Stripe's side
 * is read live, and when it cannot be, the screen says so instead of showing yesterday's numbers.
 */
export default async function PlatformPaymentsPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Payments")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Reading every customer’s invoices is a platform job. You need to be a Briefly super admin.")}</p>
        </PageBody>
      </>
    );
  }

  const overview = await paymentsOverview();
  const currency = overview.subscriptions.find((sub) => sub.mrrCents > 0)?.currency ?? "EUR";
  const paying = overview.subscriptions.filter((sub) => sub.mrrCents > 0);
  const subscriptionColumns = [
    {
      key: "workspace",
      header: tr("Workspace"),
      cell: (sub: SubscriptionRow) => (
        <Link href={`/platform/workspaces/${sub.organizationId}`} className="font-medium hover:underline" data-no-row-link>
          {sub.name}
        </Link>
      ),
    },
    { key: "plan", header: tr("Plan"), cell: (sub: SubscriptionRow) => <span className="text-xs">{sub.planName ?? "—"}</span> },
    { key: "status", header: tr("Status"), cell: (sub: SubscriptionRow) => <Badge variant={subscriptionTone(sub.status)}>{sub.status.toLowerCase().replace("_", " ")}</Badge> },
    {
      key: "price",
      header: tr("Per month"),
      cell: (sub: SubscriptionRow) => (
        <span className="tabular text-xs">
          {sub.isCustomPriced ? tr("custom") : formatCents(sub.mrrCents, sub.currency)}
          {sub.interval === "year" ? <span className="text-muted-foreground">{" "}{tr("(yearly)")}</span> : null}
        </span>
      ),
      align: "right" as const,
    },
    {
      key: "period",
      header: tr("Renews"),
      cell: (sub: SubscriptionRow) => (
        <span className="flex flex-col text-xs">
          <span>{sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "—"}</span>
          {sub.cancelAtPeriodEnd ? <span className="text-2xs text-warning">{tr("cancels then")}</span> : null}
          {sub.status === "TRIALING" && sub.trialEndsAt ? <span className="text-2xs text-muted-foreground">{tr("trial ends")}{" "}{formatDate(sub.trialEndsAt)}</span> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (sub: SubscriptionRow) => (
        <span data-no-row-link>
          <SubscriptionControls organizationId={sub.organizationId} stripeCustomerId={sub.stripeCustomerId} stripeSubscriptionId={sub.stripeSubscriptionId} livemode={overview.livemode} />
        </span>
      ),
      align: "right" as const,
    },
  ];
  const invoiceColumns = [
    {
      key: "number",
      header: tr("Invoice"),
      cell: (invoice: InvoiceRow) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs">{invoice.number ?? invoice.id}</span>
          <span className="text-2xs text-muted-foreground">{invoice.workspace ? <Link href={`/platform/workspaces/${invoice.workspace.id}`} className="hover:underline" data-no-row-link>{invoice.workspace.name}</Link> : (invoice.customerEmail ?? tr("unknown customer"))}</span>
        </span>
      ),
    },
    { key: "date", header: tr("Issued"), cell: (invoice: InvoiceRow) => <span className="text-xs">{formatDate(invoice.createdAt)}</span> },
    {
      key: "amount",
      header: tr("Amount"),
      cell: (invoice: InvoiceRow) => (
        <span className="flex flex-col items-end tabular text-xs">
          <span>{formatCents(invoice.amountDueCents, invoice.currency)}</span>
          {invoice.amountRemainingCents > 0 && invoice.amountRemainingCents !== invoice.amountDueCents ? <span className="text-2xs text-muted-foreground">{formatCents(invoice.amountRemainingCents, invoice.currency)}{" "}{tr("left")}</span> : null}
        </span>
      ),
      align: "right" as const,
    },
    {
      key: "status",
      header: tr("Status"),
      cell: (invoice: InvoiceRow) => (
        <span className="flex flex-col gap-0.5">
          <Badge variant={invoiceTone(invoice)}>{invoice.overdue && invoice.status === "open" ? tr("overdue") : invoice.status}</Badge>
          {invoice.status === "open" && invoice.attempted ? <span className="text-2xs text-muted-foreground">{invoice.attemptCount}{" "}{tr("attempts")}{invoice.nextAttemptAt ? ` · ${tr("next")} ${relativeTime(invoice.nextAttemptAt)}` : ""}</span> : null}
          {invoice.dueAt && invoice.status === "open" ? <span className="text-2xs text-muted-foreground">{tr("due")}{" "}{formatDate(invoice.dueAt)}</span> : null}
        </span>
      ),
    },
    { key: "actions", header: "", cell: (invoice: InvoiceRow) => <InvoiceControls invoice={{ id: invoice.id, status: invoice.status, hostedUrl: invoice.hostedUrl }} />, align: "right" as const },
  ];

  return (
    <>
      <PageHeader title={tr("Payments")} description={overview.configured ? (overview.account ? `${tr("Stripe account")} ${overview.account}${overview.livemode === false ? ` · ${tr("test mode")}` : ""}` : tr("Stripe is connected.")) : tr("Payments are not connected: the figures below come from the plans customers are on, and nothing can be charged.")}>
        <HubTabs tabs={PLATFORM_TABS} />
      </PageHeader>
      <PageBody className="space-y-6">
        {overview.error ? (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>{tr("Stripe could not be read just now, so invoices are missing from this screen:")}{" "}{overview.error}</span>
          </p>
        ) : null}
        {!overview.configured ? (
          <p className="text-xs text-muted-foreground">
            {tr("Connect Stripe under")}{" "}<Link href="/platform/integrations" className="font-medium text-foreground hover:underline">{tr("Integrations")}</Link>{" "}{tr("to see invoices, retry declined cards and send reminders from here.")}</p>
        ) : null}

        <StatGrid columns={5}>
          <Stat label={tr("Monthly recurring")} value={formatCents(overview.mrrCents, currency)} hint={`${paying.length} ${tr("paying workspaces")}`} icon={CircleDollarSign} hue="amber" />
          <Stat label={tr("Collected, 30 days")} value={overview.configured ? formatCents(overview.collected30Cents, currency) : "—"} hint={overview.configured ? tr("paid invoices") : tr("needs Stripe")} icon={Wallet} hue="green" />
          <Stat label={tr("Outstanding")} value={overview.configured ? formatCents(overview.outstandingCents, currency) : "—"} hint={overview.configured ? `${overview.invoices.filter((invoice) => invoice.status === "open").length} ${tr("open invoices")}` : tr("needs Stripe")} icon={Receipt} hue={overview.outstandingCents > 0 ? "coral" : "teal"} />
          <Stat label={tr("Overdue")} value={overview.configured ? overview.overdue.length : "—"} hint={overview.configured ? formatCents(overview.overdue.reduce((total, invoice) => total + invoice.amountRemainingCents, 0), currency) : tr("needs Stripe")} icon={AlertTriangle} hue={overview.overdue.length ? "coral" : "green"} />
          <Stat label={tr("Renewing in 14 days")} value={overview.renewals.length} hint={formatCents(overview.renewals.reduce((total, sub) => total + (sub.interval === "year" ? sub.priceYearlyCents : sub.priceMonthlyCents), 0), currency)} icon={CalendarClock} hue="violet" />
        </StatGrid>

        {overview.configured ? (
          <section>
            <SectionTitle>{tr("Overdue invoices")}</SectionTitle>
            <p className="mb-2 text-xs text-muted-foreground">{tr("Open past their date, or a card that was tried and declined. Charge the card again, or send the people who run the workspace a reminder with the link that pays.")}</p>
            <DataTable rows={overview.overdue} rowKey={(invoice) => invoice.id} empty={{ title: tr("Nothing overdue"), description: tr("Every invoice is paid or not yet due."), icon: Receipt }} columns={invoiceColumns} />
          </section>
        ) : null}

        <section>
          <SectionTitle>{tr("Subscriptions")}</SectionTitle>
          {overview.cancelling.length || overview.trialsEnding.length ? (
            <p className="mb-2 text-xs text-muted-foreground">
              {overview.cancelling.length ? `${overview.cancelling.length} ${tr("cancelling at the end of the period")}` : null}
              {overview.cancelling.length && overview.trialsEnding.length ? " · " : null}
              {overview.trialsEnding.length ? `${overview.trialsEnding.length} ${tr("trials ending within a fortnight")}` : null}
            </p>
          ) : null}
          <DataTable rows={overview.subscriptions} rowKey={(sub) => sub.organizationId} onRowHref={(sub) => `/platform/workspaces/${sub.organizationId}`} empty={{ title: tr("No workspaces"), description: tr("The first one is created by onboarding."), icon: Wallet }} columns={subscriptionColumns} />
        </section>

        {overview.configured ? (
          <section>
            <SectionTitle>{tr("Recent invoices")}</SectionTitle>
            <DataTable rows={overview.invoices} rowKey={(invoice) => invoice.id} empty={{ title: tr("No invoices yet"), description: tr("Stripe has not issued any."), icon: Receipt }} columns={invoiceColumns} dense />
          </section>
        ) : null}
      </PageBody>
    </>
  );
}
