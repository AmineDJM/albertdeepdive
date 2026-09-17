import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { integrationStatuses } from "@/server/integrations/service";
import { CATEGORY_LABELS } from "@/server/integrations/registry";
import { env } from "@/server/env";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { PLATFORM_TABS } from "@/components/newsroom/nav";
import { IntegrationCard } from "./integration-card";

export const dynamic = "force-dynamic";

/**
 * Everything Briefly plugs into, in one place.
 *
 * The point of this screen is that running Briefly should not require a deploy. A super admin
 * connects Stripe, connects a sender, connects a model, sees at a glance what is live and what is
 * not, and can prove each one works before a customer discovers otherwise.
 */
export default async function IntegrationsPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title="Integrations" />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">Connecting services is a platform-level job. You need to be a Briefly super admin to see this.</p>
        </PageBody>
      </>
    );
  }

  const statuses = await integrationStatuses();
  const connected = statuses.filter((s) => s.configured).length;
  const categories = [...new Set(statuses.map((s) => s.category))];
  const webhookUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/stripe`;

  return (
    <>
      <PageHeader
        title="Integrations"
        description={`${connected} of ${statuses.length} connected. Keys are encrypted before they are stored and never shown again — change one without redeploying.`}
      >
        <HubTabs tabs={PLATFORM_TABS} />
      </PageHeader>
      <PageBody className="space-y-8">
        {categories.map((category) => (
          <section key={category}>
            <SectionTitle>{CATEGORY_LABELS[category]}</SectionTitle>
            <div className="mt-3 space-y-3">
              {statuses
                .filter((s) => s.category === category)
                .map((integration) => (
                  <IntegrationCard key={integration.key} integration={integration} />
                ))}
            </div>
            {category === "payments" ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Point your Stripe webhook at <span className="font-mono text-foreground">{webhookUrl}</span> and subscribe it to{" "}
                <span className="font-mono">checkout.session.completed</span>, <span className="font-mono">customer.subscription.*</span> and{" "}
                <span className="font-mono">invoice.payment_failed</span>.
              </p>
            ) : null}
          </section>
        ))}
      </PageBody>
    </>
  );
}
