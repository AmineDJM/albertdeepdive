import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { accountSummary, getInvoice, getSubscription, listInvoices, mapStatus, payInvoice, stripeConfigured, type StripeInvoice } from "@/server/billing/stripe";
import { sendEmail } from "@/server/email";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { AppError, NotFoundError } from "@/lib/action-result";

const log = createLogger("platform-payments");

/**
 * Money, from the platform's side of the counter.
 *
 * The database knows which plan every customer is on and what Stripe last said about it; Stripe
 * knows the invoices, which of them were paid, and which card was declined. This module puts the
 * two next to each other and offers the three things somebody actually does about an unpaid
 * invoice: charge the card again, remind the customer, and pull the subscription's real state
 * when a webhook was missed.
 *
 * Stripe is read live and never cached: a payments screen that is an hour behind is one that tells
 * you a customer is overdue after they have paid.
 */

const DAY = 24 * 60 * 60 * 1000;
const PAYING = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

export type SubscriptionRow = {
  organizationId: string;
  name: string;
  slug: string;
  locale: string;
  planId: string | null;
  planName: string | null;
  planKey: string | null;
  status: string;
  interval: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  isCustomPriced: boolean;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEndsAt: Date | null;
  canceledAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  overrides: s.Entitlements;
  /** What this subscription brings in per month, yearly plans spread over twelve. */
  mrrCents: number;
};

/** What a subscription brings in per month, in cents. Trials count: the dashboard counts them too. */
export function monthlyRevenueCents(sub: { status: string; interval: string; priceMonthlyCents: number; priceYearlyCents: number } | null | undefined): number {
  if (!sub || !PAYING.has(sub.status)) return 0;
  return sub.interval === "year" ? Math.round(sub.priceYearlyCents / 12) : sub.priceMonthlyCents;
}

/** Every workspace's subscription, with its plan and its price — including workspaces on nothing. */
export async function subscriptionRows(): Promise<SubscriptionRow[]> {
  const rows = await db
    .select({
      organizationId: s.organizations.id,
      name: s.organizations.name,
      slug: s.organizations.slug,
      locale: s.organizations.locale,
      planId: s.organizationSubscriptions.planId,
      planName: s.plans.name,
      planKey: s.plans.key,
      status: s.organizationSubscriptions.status,
      interval: s.organizationSubscriptions.interval,
      priceMonthlyCents: s.plans.priceMonthlyCents,
      priceYearlyCents: s.plans.priceYearlyCents,
      currency: s.plans.currency,
      isCustomPriced: s.plans.isCustomPriced,
      currentPeriodEnd: s.organizationSubscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: s.organizationSubscriptions.cancelAtPeriodEnd,
      trialEndsAt: s.organizationSubscriptions.trialEndsAt,
      canceledAt: s.organizationSubscriptions.canceledAt,
      stripeCustomerId: s.organizationSubscriptions.stripeCustomerId,
      stripeSubscriptionId: s.organizationSubscriptions.stripeSubscriptionId,
      overrides: s.organizationSubscriptions.overrides,
    })
    .from(s.organizations)
    .leftJoin(s.organizationSubscriptions, eq(s.organizationSubscriptions.organizationId, s.organizations.id))
    .leftJoin(s.plans, eq(s.plans.id, s.organizationSubscriptions.planId))
    .orderBy(s.organizations.name);

  return rows.map((row) => {
    const base = {
      ...row,
      status: row.status ?? "FREE",
      interval: row.interval ?? "month",
      priceMonthlyCents: row.priceMonthlyCents ?? 0,
      priceYearlyCents: row.priceYearlyCents ?? 0,
      currency: row.currency ?? "EUR",
      isCustomPriced: row.isCustomPriced ?? false,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
      overrides: row.overrides ?? {},
    };
    return { ...base, mrrCents: monthlyRevenueCents(base) };
  });
}

/* ── Invoices ─────────────────────────────────────────────────────────────────────────────── */

export type InvoiceRow = {
  id: string;
  number: string | null;
  status: string;
  amountDueCents: number;
  amountPaidCents: number;
  amountRemainingCents: number;
  currency: string;
  createdAt: Date;
  dueAt: Date | null;
  hostedUrl: string | null;
  pdfUrl: string | null;
  attempted: boolean;
  attemptCount: number;
  nextAttemptAt: Date | null;
  collectionMethod: string;
  customerEmail: string | null;
  workspace: { id: string; name: string } | null;
  /** Open past its due date, or a card that was tried and declined: money somebody has to chase. */
  overdue: boolean;
};

const fromUnix = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000) : null);

export function invoiceRow(invoice: StripeInvoice, workspace: { id: string; name: string } | null, now = new Date()): InvoiceRow {
  const dueAt = fromUnix(invoice.due_date);
  const open = invoice.status === "open";
  const overdue = invoice.status === "uncollectible" || (open && ((dueAt !== null && dueAt < now) || (invoice.attempted && invoice.amount_remaining > 0)));
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    amountRemainingCents: invoice.amount_remaining,
    currency: invoice.currency.toUpperCase(),
    createdAt: new Date(invoice.created * 1000),
    dueAt,
    hostedUrl: invoice.hosted_invoice_url,
    pdfUrl: invoice.invoice_pdf,
    attempted: invoice.attempted,
    attemptCount: invoice.attempt_count,
    nextAttemptAt: fromUnix(invoice.next_payment_attempt),
    collectionMethod: invoice.collection_method,
    customerEmail: invoice.customer_email ?? null,
    workspace,
    overdue,
  };
}

async function workspaceByCustomer(): Promise<Map<string, { id: string; name: string }>> {
  const rows = await db
    .select({ customer: s.organizationSubscriptions.stripeCustomerId, id: s.organizations.id, name: s.organizations.name })
    .from(s.organizationSubscriptions)
    .innerJoin(s.organizations, eq(s.organizations.id, s.organizationSubscriptions.organizationId));
  return new Map(rows.filter((row) => row.customer).map((row) => [row.customer as string, { id: row.id, name: row.name }]));
}

/** One customer's invoices, newest first. Null when Stripe is off or the customer has no Stripe record. */
export async function invoicesForWorkspace(organizationId: string, limit = 24): Promise<{ rows: InvoiceRow[]; error: string | null } | null> {
  if (!(await stripeConfigured())) return null;
  const sub = await db.query.organizationSubscriptions.findFirst({ where: eq(s.organizationSubscriptions.organizationId, organizationId), columns: { stripeCustomerId: true } });
  if (!sub?.stripeCustomerId) return null;
  const org = await db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { id: true, name: true } });
  try {
    const invoices = await listInvoices({ customerId: sub.stripeCustomerId, limit });
    return { rows: invoices.map((invoice) => invoiceRow(invoice, org ?? null)), error: null };
  } catch (err) {
    log.warn("invoices unavailable", { organizationId, err });
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

/* ── The overview ─────────────────────────────────────────────────────────────────────────── */

export type PaymentsOverview = {
  configured: boolean;
  livemode: boolean | null;
  account: string | null;
  /** Why Stripe's side is missing, when it is. The database side is always there. */
  error: string | null;
  mrrCents: number;
  byStatus: { status: string; count: number; mrrCents: number }[];
  subscriptions: SubscriptionRow[];
  /** Renewing within a fortnight and not cancelling: the money that is about to be asked for. */
  renewals: SubscriptionRow[];
  trialsEnding: SubscriptionRow[];
  cancelling: SubscriptionRow[];
  invoices: InvoiceRow[];
  overdue: InvoiceRow[];
  collected30Cents: number;
  outstandingCents: number;
};

export async function paymentsOverview(now = new Date()): Promise<PaymentsOverview> {
  const [subscriptions, configured] = await Promise.all([subscriptionRows(), stripeConfigured()]);
  const fortnight = new Date(now.getTime() + 14 * DAY);

  const byStatusMap = new Map<string, { count: number; mrrCents: number }>();
  for (const sub of subscriptions) {
    const entry = byStatusMap.get(sub.status) ?? { count: 0, mrrCents: 0 };
    entry.count += 1;
    entry.mrrCents += sub.mrrCents;
    byStatusMap.set(sub.status, entry);
  }
  const byStatus = [...byStatusMap.entries()].map(([status, entry]) => ({ status, ...entry })).sort((a, b) => b.count - a.count);

  const overview: PaymentsOverview = {
    configured,
    livemode: null,
    account: null,
    error: null,
    mrrCents: subscriptions.reduce((total, sub) => total + sub.mrrCents, 0),
    byStatus,
    subscriptions,
    renewals: subscriptions.filter((sub) => PAYING.has(sub.status) && !sub.cancelAtPeriodEnd && sub.currentPeriodEnd && sub.currentPeriodEnd >= now && sub.currentPeriodEnd <= fortnight),
    trialsEnding: subscriptions.filter((sub) => sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt >= now && sub.trialEndsAt <= fortnight),
    cancelling: subscriptions.filter((sub) => sub.cancelAtPeriodEnd && PAYING.has(sub.status)),
    invoices: [],
    overdue: [],
    collected30Cents: 0,
    outstandingCents: 0,
  };
  if (!configured) return overview;

  try {
    const [account, invoices, byCustomer] = await Promise.all([accountSummary(), listInvoices({ limit: 100 }), workspaceByCustomer()]);
    overview.livemode = account.livemode;
    overview.account = account.name ?? account.id;
    const month = new Date(now.getTime() - 30 * DAY);
    const rows = invoices.filter((invoice) => invoice.status !== "draft").map((invoice) => invoiceRow(invoice, (invoice.customer && byCustomer.get(invoice.customer)) || null, now));
    overview.invoices = rows;
    overview.overdue = rows.filter((row) => row.overdue);
    overview.collected30Cents = rows.filter((row) => row.status === "paid" && row.createdAt >= month).reduce((total, row) => total + row.amountPaidCents, 0);
    overview.outstandingCents = rows.filter((row) => row.status === "open").reduce((total, row) => total + row.amountRemainingCents, 0);
  } catch (err) {
    log.warn("stripe side of the payments overview unavailable", { err });
    overview.error = err instanceof Error ? err.message : String(err);
  }
  return overview;
}

/* ── Acting on an invoice ─────────────────────────────────────────────────────────────────── */

async function workspaceForInvoice(invoice: StripeInvoice) {
  if (!invoice.customer) return null;
  const row = await db
    .select({ id: s.organizations.id, name: s.organizations.name, locale: s.organizations.locale })
    .from(s.organizationSubscriptions)
    .innerJoin(s.organizations, eq(s.organizations.id, s.organizationSubscriptions.organizationId))
    .where(eq(s.organizationSubscriptions.stripeCustomerId, invoice.customer))
    .limit(1);
  return row[0] ?? null;
}

/** Charge the card on file again, now, rather than waiting for Stripe's next scheduled attempt. */
export async function retryInvoicePayment(invoiceId: string, actorId?: string | null): Promise<InvoiceRow> {
  const before = await getInvoice(invoiceId);
  if (before.status !== "open") throw new AppError(`This invoice is ${before.status}, not open.`, "INVOICE_NOT_OPEN", 400);
  const workspace = await workspaceForInvoice(before);
  const after = await payInvoice(invoiceId);
  await audit({
    action: "billing.retry",
    entityType: "SETTING",
    entityId: workspace?.id ?? null,
    organizationId: workspace?.id ?? null,
    userId: actorId ?? null,
    metadata: { invoice: after.number ?? after.id, status: after.status, amountCents: after.amount_due },
  });
  return invoiceRow(after, workspace ? { id: workspace.id, name: workspace.name } : null);
}

const money = (cents: number, currency: string, locale: string) => new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", { style: "currency", currency }).format(cents / 100);
const date = (value: Date | null, locale: string) => (value ? new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "long" }).format(value) : "");

/** The words of the reminder, in the customer's language rather than the sender's. */
const REMINDER = {
  en: {
    subject: (n: string, app: string) => `Your ${app} invoice ${n} is waiting`,
    title: "An invoice is waiting for payment",
    body: (n: string, amount: string, due: string) => `Invoice ${n} for ${amount}${due ? `, due ${due}` : ""} has not been paid yet. The payment can be made in a minute from the link below, and everything continues as before once it is.`,
    declined: "The card on file was tried and declined; a different card can be used on the payment page.",
    cta: "View and pay the invoice",
    invoice: "Invoice",
    amount: "Amount",
    due: "Due",
  },
  fr: {
    subject: (n: string, app: string) => `Votre facture ${app} ${n} est en attente`,
    title: "Une facture attend son règlement",
    body: (n: string, amount: string, due: string) => `La facture ${n} de ${amount}${due ? `, à régler avant le ${due}` : ""} n'a pas encore été payée. Le règlement se fait en une minute depuis le lien ci-dessous, et tout continue comme avant une fois effectué.`,
    declined: "La carte enregistrée a été refusée ; une autre carte peut être utilisée sur la page de paiement.",
    cta: "Voir et payer la facture",
    invoice: "Facture",
    amount: "Montant",
    due: "Échéance",
  },
} as const;

/**
 * Remind the people who run the workspace, by email, with the link that pays.
 *
 * Ours, not Stripe's: Stripe only emails invoices it collects by transfer, and a card that keeps
 * being declined gets silence. Every owner and admin of the workspace gets it, in the workspace's
 * language, and the invoice's own address as a fallback when the workspace has nobody left.
 */
export async function sendPaymentReminder(invoiceId: string, options: { actorId?: string | null; appName: string }): Promise<{ sentTo: string[]; invoice: InvoiceRow }> {
  const invoice = await getInvoice(invoiceId);
  if (invoice.status !== "open" && invoice.status !== "uncollectible") throw new AppError(`This invoice is ${invoice.status}; there is nothing to remind anybody of.`, "INVOICE_NOT_OPEN", 400);
  if (!invoice.hosted_invoice_url) throw new AppError("Stripe has no payment page for this invoice.", "INVOICE_NO_URL", 400);
  const workspace = await workspaceForInvoice(invoice);

  const recipients = workspace
    ? (
        await db
          .select({ email: s.users.email })
          .from(s.organizationMembers)
          .innerJoin(s.users, eq(s.users.id, s.organizationMembers.userId))
          .where(and(eq(s.organizationMembers.organizationId, workspace.id), inArray(s.organizationMembers.role, ["OWNER", "ADMIN"]), eq(s.users.isActive, true)))
      ).map((row) => row.email)
    : [];
  if (!recipients.length && invoice.customer_email) recipients.push(invoice.customer_email);
  if (!recipients.length) throw new NotFoundError("Somebody to remind");

  const locale = workspace?.locale === "fr" ? "fr" : "en";
  const words = REMINDER[locale];
  const number = invoice.number ?? invoice.id;
  const amount = money(invoice.amount_remaining || invoice.amount_due, invoice.currency.toUpperCase(), locale);
  const due = date(fromUnix(invoice.due_date), locale);
  const declined = invoice.attempted && invoice.amount_remaining > 0 && invoice.collection_method === "charge_automatically";

  for (const to of recipients) {
    await sendEmail({
      to,
      subject: words.subject(number, options.appName),
      template: "billing_reminder",
      organizationId: workspace?.id ?? null,
      layout: {
        appName: options.appName,
        kicker: options.appName,
        title: words.title,
        preheader: words.subject(number, options.appName),
        blocks: [
          { type: "paragraph", text: words.body(number, amount, due) },
          ...(declined ? [{ type: "paragraph" as const, text: words.declined }] : []),
          { type: "kv", rows: [{ label: words.invoice, value: number }, { label: words.amount, value: amount }, ...(due ? [{ label: words.due, value: due }] : [])] },
        ],
        cta: { label: words.cta, url: invoice.hosted_invoice_url },
        footer: workspace?.name ?? undefined,
      },
    });
  }

  await audit({
    action: "billing.reminder",
    entityType: "SETTING",
    entityId: workspace?.id ?? null,
    organizationId: workspace?.id ?? null,
    userId: options.actorId ?? null,
    metadata: { invoice: number, recipients: recipients.length, amountCents: invoice.amount_remaining },
  });
  return { sentTo: recipients, invoice: invoiceRow(invoice, workspace ? { id: workspace.id, name: workspace.name } : null) };
}

/**
 * Pull the subscription's real state from Stripe.
 *
 * Webhooks are the normal way this stays in step, and webhooks get lost — a redeploy in the wrong
 * minute, a signing secret rotated on one side only. This is the manual way, and it is the same
 * mapping the webhook uses, so the two can never disagree about what "past due" means.
 */
export async function syncSubscriptionFromStripe(organizationId: string, actorId?: string | null) {
  const local = await db.query.organizationSubscriptions.findFirst({ where: eq(s.organizationSubscriptions.organizationId, organizationId) });
  if (!local) throw new NotFoundError("Subscription");
  if (!local.stripeSubscriptionId) throw new AppError("This workspace has no Stripe subscription to read.", "NO_STRIPE_SUBSCRIPTION", 400);
  const remote = await getSubscription(local.stripeSubscriptionId);
  const status = mapStatus(remote.status);
  const patch = {
    status,
    currentPeriodEnd: fromUnix(remote.current_period_end),
    cancelAtPeriodEnd: remote.cancel_at_period_end,
    trialEndsAt: fromUnix(remote.trial_end),
    interval: remote.items?.data?.[0]?.price?.recurring?.interval ?? local.interval,
    canceledAt: status === "CANCELED" ? (local.canceledAt ?? new Date()) : null,
  };
  await db.update(s.organizationSubscriptions).set(patch).where(eq(s.organizationSubscriptions.id, local.id));
  await audit({
    action: "billing.sync",
    entityType: "SETTING",
    entityId: organizationId,
    organizationId,
    userId: actorId ?? null,
    metadata: { from: local.status, to: status, stripeStatus: remote.status },
  });
  return { ...local, ...patch };
}
