import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listPlans } from "@/server/billing/plans";
import { FLAG_KEYS, OVERRIDE_LABELS } from "@/server/platform/overrides";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { FlagMatrix, type FlagRow } from "./flag-matrix";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Feature flags: what each plan may do, and which customers were given more.
 *
 * Every flag here is a gate the product really enforces on the server — a switch that only hid a
 * button would be a lie. Rollout is by plan, or by organization through an override on its sheet;
 * there is no percentage rollout because nothing in the product samples one, and a control that
 * did nothing would not belong on this page.
 */
export default async function FlagsPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <PageHeader title={tr("Feature flags")} />;
  const [plans, subscriptions] = await Promise.all([listPlans(true), db.select({ overrides: s.organizationSubscriptions.overrides }).from(s.organizationSubscriptions)]);
  const flags: FlagRow[] = FLAG_KEYS.map((key) => ({
    key,
    label: OVERRIDE_LABELS[key] ?? key,
    perPlan: Object.fromEntries(plans.map((plan) => [plan.id, (plan.entitlements as Record<string, unknown>)[key] === true])),
    overrides: subscriptions.filter((row) => key in ((row.overrides ?? {}) as Record<string, unknown>)).length,
  }));
  return (
    <>
      <PageHeader title={tr("Feature flags")} description={tr("What each plan switches on. A single organization's exception is set from its sheet and counted here.")} />
      <PageBody className="space-y-4">
        <FlagMatrix flags={flags} plans={plans.map((plan) => ({ id: plan.id, name: plan.name }))} />
        <p className="text-xs text-muted-foreground">{tr("Flags are entitlements: the server checks them where the feature is used, never the interface alone.")}</p>
      </PageBody>
    </>
  );
}
