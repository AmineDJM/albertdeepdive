import { requireTenant } from "@/server/tenancy/context";
import { usageReport } from "@/server/billing/entitlements";
import { listPlans } from "@/server/billing/plans";
import { ensureSubscription } from "@/server/billing/service";
import { stripeConfigured } from "@/server/billing/stripe";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { ProgressBar } from "@/components/newsroom/stat";
import { PlanCards, type PlanCard } from "./plan-cards";
import { formatDate } from "@/lib/utils";
import { getTranslations } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const tenant = await requireTenant();
  const [t, subscription, report, plans, stripeReady] = await Promise.all([getTranslations(), ensureSubscription(tenant.organizationId), usageReport(tenant.organizationId), listPlans(), stripeConfigured()]);
  const canManage = tenant.role === "OWNER" || tenant.role === "ADMIN";

  const cards: PlanCard[] = plans.map((p) => ({
    key: p.key,
    name: p.name,
    tagline: p.tagline,
    priceMonthlyCents: p.priceMonthlyCents,
    priceYearlyCents: p.priceYearlyCents,
    currency: p.currency,
    highlights: p.highlights,
    isFeatured: p.isFeatured,
    isCustomPriced: p.isCustomPriced,
    purchasable: Boolean(p.stripeMonthlyPriceId || p.stripeYearlyPriceId),
  }));

  return (
    <>
      <PageHeader title={t("billing.title")} description={t("billing.onPlan", { workspace: tenant.name, plan: report.plan.planName })} />
      <PageBody className="space-y-6">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SectionTitle>{t("billing.usage")}</SectionTitle>
            {report.plan.currentPeriodEnd ? (
              <p className="text-xs text-muted-foreground">
                {report.plan.cancelAtPeriodEnd ? t("billing.ends", { date: formatDate(report.plan.currentPeriodEnd) }) : t("billing.renews", { date: formatDate(report.plan.currentPeriodEnd) })}
              </p>
            ) : null}
          </div>
          <dl className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {report.lines.map((line) => (
              <div key={line.key}>
                <dt className="label-caps">{t(`billing.${line.key}` as "billing.publications")}</dt>
                <dd className="mt-1 text-[15px] font-medium tabular">
                  {line.used.toLocaleString()}
                  <span className="text-[13px] font-normal text-muted-foreground"> / {line.limit === null ? t("common.unlimited") : line.limit.toLocaleString()}</span>
                </dd>
                {line.limit !== null ? <ProgressBar value={line.used} max={line.limit} className="mt-1.5" /> : null}
              </div>
            ))}
          </dl>
          {report.plan.status === "PAST_DUE" ? (
            <p className="mt-4 rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              {t("billing.pastDue")}
            </p>
          ) : null}
          {report.plan.trialEndsAt && report.plan.status === "TRIALING" ? (
            <p className="mt-4 text-xs text-muted-foreground">{t("billing.trialEnds", { date: formatDate(report.plan.trialEndsAt) })}</p>
          ) : null}
        </section>

        <section>
          <SectionTitle>{t("billing.plans")}</SectionTitle>
          <div className="mt-3">
            <PlanCards
              plans={cards}
              currentKey={report.plan.planKey}
              canManage={canManage}
              hasStripeCustomer={Boolean(subscription.stripeCustomerId)}
              cancelAtPeriodEnd={subscription.cancelAtPeriodEnd}
              stripeReady={stripeReady}
            />
          </div>
        </section>
      </PageBody>
    </>
  );
}
