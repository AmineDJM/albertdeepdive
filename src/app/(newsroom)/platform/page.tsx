import { Building2, CreditCard } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listOrganizations } from "@/server/tenancy/service";
import { listPlans } from "@/server/billing/plans";
import { platformBillingSummary } from "@/server/billing/entitlements";
import { stripeConfigured } from "@/server/billing/stripe";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { PLATFORM_TABS } from "@/components/newsroom/nav";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { PlanEditor, type EditablePlan } from "./plan-editor";
import { WorkspacePlanPicker } from "./workspace-plan-picker";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const money = (cents: number, currency = "EUR") => new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);

/**
 * The platform console: every customer on this Briefly, and what they pay.
 *
 * Gated on `settings:manage`, which only a platform super admin holds. This is the one screen that
 * deliberately reads across workspaces, so the check is explicit rather than inherited.
 */
export default async function PlatformPage() {
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

  const [organizations, plans, summary, subscriptions, stripeReady] = await Promise.all([
    listOrganizations(),
    listPlans(true),
    platformBillingSummary(),
    db
      .select({
        organizationId: s.organizationSubscriptions.organizationId,
        planId: s.organizationSubscriptions.planId,
        planName: s.plans.name,
        status: s.organizationSubscriptions.status,
        currentPeriodEnd: s.organizationSubscriptions.currentPeriodEnd,
        stripeCustomerId: s.organizationSubscriptions.stripeCustomerId,
      })
      .from(s.organizationSubscriptions)
      .leftJoin(s.plans, eq(s.plans.id, s.organizationSubscriptions.planId)),
    stripeConfigured(),
  ]);

  const byOrg = new Map(subscriptions.map((r) => [r.organizationId, r]));
  const planOptions = plans.map((p) => ({ id: p.id, name: p.name }));
  const payingWorkspaces = subscriptions.filter((r) => r.status === "ACTIVE" || r.status === "TRIALING" || r.status === "PAST_DUE").length;

  return (
    <>
      <PageHeader
        title="Workspaces & plans"
        description={stripeReady ? "Every customer on this Briefly." : "Every customer on this Briefly. Payments are not connected, so nothing can be charged yet."}
      >
        <HubTabs tabs={PLATFORM_TABS} />
      </PageHeader>
      <PageBody className="space-y-6">
        <StatGrid>
          <Stat label="Workspaces" value={organizations.length} />
          <Stat label="On a paid plan" value={payingWorkspaces} />
          <Stat label="Monthly recurring" value={money(summary.mrrCents)} />
          <Stat label="Plans" value={plans.length} />
        </StatGrid>

        <section>
          <SectionTitle>Plans</SectionTitle>
          <div className="mt-3">
            <DataTable
              rows={plans}
              rowKey={(p) => p.id}
              empty={{ title: "No plans", description: "Plans are seeded on migration.", icon: CreditCard }}
              columns={[
                {
                  key: "name",
                  header: "Plan",
                  cell: (p) => (
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.isDefault ? <Badge variant="muted">default</Badge> : null}
                      {p.isFeatured ? <Badge>popular</Badge> : null}
                      {!p.isPublic ? <Badge variant="muted">hidden</Badge> : null}
                    </span>
                  ),
                },
                { key: "key", header: "Key", cell: (p) => <span className="font-mono text-2xs text-muted-foreground">{p.key}</span> },
                { key: "monthly", header: "Monthly", cell: (p) => <span className="tabular">{p.isCustomPriced ? "Custom" : money(p.priceMonthlyCents, p.currency)}</span>, align: "right" },
                { key: "yearly", header: "Yearly", cell: (p) => <span className="tabular">{p.isCustomPriced ? "—" : money(p.priceYearlyCents, p.currency)}</span>, align: "right" },
                {
                  key: "stripe",
                  header: "Stripe",
                  cell: (p) =>
                    p.isCustomPriced ? (
                      <span className="text-2xs text-muted-foreground">n/a</span>
                    ) : p.stripeMonthlyPriceId || p.stripeYearlyPriceId ? (
                      <Badge variant="muted">linked</Badge>
                    ) : (
                      <span className="text-2xs text-muted-foreground">not linked</span>
                    ),
                },
                {
                  key: "workspaces",
                  header: "Workspaces",
                  cell: (p) => <span className="tabular">{summary.rows.find((r) => r.planKey === p.key)?.workspaces ?? 0}</span>,
                  align: "right",
                },
                {
                  key: "actions",
                  header: "",
                  cell: (p) => (
                    <span data-no-row-link>
                      <PlanEditor
                        plan={
                          {
                            id: p.id,
                            key: p.key,
                            name: p.name,
                            tagline: p.tagline,
                            priceMonthlyCents: p.priceMonthlyCents,
                            priceYearlyCents: p.priceYearlyCents,
                            currency: p.currency,
                            stripeMonthlyPriceId: p.stripeMonthlyPriceId,
                            stripeYearlyPriceId: p.stripeYearlyPriceId,
                            entitlements: p.entitlements as Record<string, unknown>,
                            highlights: p.highlights,
                            isPublic: p.isPublic,
                            isFeatured: p.isFeatured,
                            isDefault: p.isDefault,
                            trialDays: p.trialDays,
                          } satisfies EditablePlan
                        }
                      />
                    </span>
                  ),
                  align: "right",
                  width: "60px",
                },
              ]}
            />
          </div>
        </section>

        <section>
          <SectionTitle>Workspaces</SectionTitle>
          <div className="mt-3">
            <DataTable
              rows={organizations}
              rowKey={(o) => o.id}
              empty={{ title: "No workspaces", description: "The first one is created by onboarding.", icon: Building2 }}
              columns={[
                {
                  key: "name",
                  header: "Workspace",
                  cell: (o) => (
                    <span className="flex flex-col">
                      <span className="font-medium">{o.name}</span>
                      <span className="font-mono text-2xs text-muted-foreground">/{o.slug}</span>
                    </span>
                  ),
                },
                { key: "type", header: "Type", cell: (o) => <span className="text-xs capitalize">{o.type.toLowerCase()}</span> },
                { key: "members", header: "Members", cell: (o) => <span className="tabular">{o.members}</span>, align: "right" },
                { key: "publications", header: "Titles", cell: (o) => <span className="tabular">{o.publications}</span>, align: "right" },
                {
                  key: "status",
                  header: "Billing",
                  cell: (o) => {
                    const sub = byOrg.get(o.id);
                    if (!sub) return <span className="text-2xs text-muted-foreground">—</span>;
                    return (
                      <span className="flex flex-col">
                        <Badge variant={sub.status === "ACTIVE" || sub.status === "TRIALING" ? "default" : sub.status === "PAST_DUE" ? "warning" : "muted"}>{sub.status.toLowerCase().replace("_", " ")}</Badge>
                        {sub.currentPeriodEnd ? <span className="mt-0.5 text-2xs text-muted-foreground">to {formatDate(sub.currentPeriodEnd)}</span> : null}
                      </span>
                    );
                  },
                },
                {
                  key: "plan",
                  header: "Plan",
                  cell: (o) => (
                    <span data-no-row-link>
                      <WorkspacePlanPicker organizationId={o.id} planId={byOrg.get(o.id)?.planId ?? null} plans={planOptions} />
                    </span>
                  ),
                  align: "right",
                },
                { key: "created", header: "Since", cell: (o) => <span className="text-xs text-muted-foreground">{formatDate(o.createdAt)}</span>, align: "right" },
              ]}
            />
          </div>
        </section>
      </PageBody>
    </>
  );
}
