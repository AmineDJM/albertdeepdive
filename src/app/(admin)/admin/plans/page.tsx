import { CreditCard } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listPlans } from "@/server/billing/plans";
import { platformBillingSummary } from "@/server/billing/entitlements";
import { stripeConfigured } from "@/server/billing/stripe";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { PlanEditor, type EditablePlan } from "../organizations/plan-editor";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const money = (cents: number, currency = "EUR") => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);

/**
 * Plans and what they cost.
 *
 * Names, prices and entitlements live here and nowhere in the code: the product reads a plan's
 * entitlements at the moment it enforces a limit, so a new price or a new allowance is a row
 * edited, not a release shipped.
 */
export default async function PlansPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <PageHeader title={tr("Plans & pricing")} />;
  const [plans, summary, stripeReady] = await Promise.all([listPlans(true), platformBillingSummary(), stripeConfigured()]);
  const linked = plans.filter((p) => p.stripeMonthlyPriceId || p.stripeYearlyPriceId).length;
  return (
    <>
      <PageHeader title={tr("Plans & pricing")} description={stripeReady ? tr("Every plan a customer can be on. Prices are charged through Stripe once a plan is linked to its prices.") : tr("Every plan a customer can be on. Payments are not connected yet, so nothing is charged.")} />
      <PageBody className="space-y-6">
        <StatGrid>
          <Stat label={tr("Plans")} value={plans.length} hint={`${plans.filter((p) => p.isPublic).length} ${tr("public")}`} />
          <Stat label={tr("Monthly recurring")} value={money(summary.mrrCents)} hue="amber" />
          <Stat label={tr("Linked to Stripe")} value={`${linked} / ${plans.filter((p) => !p.isCustomPriced).length}`} hint={tr("priced plans with Stripe prices")} />
          <Stat label={tr("Trial days")} value={plans.find((p) => p.isFeatured)?.trialDays ?? plans[0]?.trialDays ?? 0} hint={tr("on the featured plan")} />
        </StatGrid>
        <DataTable
          rows={plans}
          rowKey={(p) => p.id}
          empty={{ title: tr("No plans"), description: tr("Plans are seeded on migration."), icon: CreditCard }}
          columns={[
            {
              key: "name",
              header: tr("Plan"),
              cell: (p) => (
                <span className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.isDefault ? <Badge variant="muted">{tr("default")}</Badge> : null}
                  {p.isFeatured ? <Badge>{tr("popular")}</Badge> : null}
                  {!p.isPublic ? <Badge variant="muted">{tr("hidden")}</Badge> : null}
                </span>
              ),
            },
            { key: "key", header: tr("Key"), cell: (p) => <span className="font-mono text-2xs text-muted-foreground">{p.key}</span> },
            { key: "monthly", header: tr("Monthly"), cell: (p) => <span className="tabular">{p.isCustomPriced ? tr("Custom") : money(p.priceMonthlyCents, p.currency)}</span>, align: "right" },
            { key: "yearly", header: tr("Yearly"), cell: (p) => <span className="tabular">{p.isCustomPriced ? "—" : money(p.priceYearlyCents, p.currency)}</span>, align: "right" },
            { key: "trial", header: tr("Trial"), cell: (p) => <span className="tabular text-xs">{p.trialDays ? `${p.trialDays} ${tr("days")}` : "—"}</span>, align: "right" },
            {
              key: "stripe",
              header: "Stripe",
              cell: (p) => (p.isCustomPriced ? <span className="text-2xs text-muted-foreground">n/a</span> : p.stripeMonthlyPriceId || p.stripeYearlyPriceId ? <Badge variant="muted">{tr("linked")}</Badge> : <span className="text-2xs text-muted-foreground">{tr("not linked")}</span>),
            },
            { key: "workspaces", header: tr("Organizations"), cell: (p) => <span className="tabular">{summary.rows.find((r) => r.planKey === p.key)?.workspaces ?? 0}</span>, align: "right" },
            { key: "paying", header: tr("Paying"), cell: (p) => <span className="tabular">{summary.rows.find((r) => r.planKey === p.key)?.paying ?? 0}</span>, align: "right" },
            {
              key: "actions",
              header: "",
              cell: (p) => (
                <span data-no-row-link>
                  <PlanEditor plan={{ id: p.id, key: p.key, name: p.name, tagline: p.tagline, priceMonthlyCents: p.priceMonthlyCents, priceYearlyCents: p.priceYearlyCents, currency: p.currency, stripeMonthlyPriceId: p.stripeMonthlyPriceId, stripeYearlyPriceId: p.stripeYearlyPriceId, entitlements: p.entitlements as Record<string, unknown>, highlights: p.highlights, isPublic: p.isPublic, isFeatured: p.isFeatured, isDefault: p.isDefault, trialDays: p.trialDays } satisfies EditablePlan} />
                </span>
              ),
              align: "right",
              width: "60px",
            },
          ]}
        />
        <p className="text-xs text-muted-foreground">{tr("Editing a plan changes what every organization on it may do, from the next request. A single customer's exception is set from their organization sheet, as an override, and leaves the plan untouched.")}</p>
      </PageBody>
    </>
  );
}
