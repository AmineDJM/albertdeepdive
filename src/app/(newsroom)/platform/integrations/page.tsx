import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { integrationStatuses } from "@/server/integrations/service";
import { CATEGORY_LABELS } from "@/server/integrations/registry";
import { env } from "@/server/env";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { PLATFORM_TABS } from "@/components/newsroom/nav";
import { IntegrationCard } from "./integration-card";
import { SETUP_SUPPORTED } from "@/server/integrations/setup";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Everything Briefly plugs into, in one place.
 *
 * The point of this screen is that running Briefly should not require a deploy — and, past that,
 * that it should not require reading four other dashboards either. Pasting a key is the easy half;
 * the half that goes wrong is creating a webhook with the right events, six Stripe price ids, a
 * verified sender, a model name your account can actually reach. So each service has one button that
 * does all of that by calling the service, and reports each step in a sentence you can check.
 */

/** What the setup button says, per service. Named for what it does, not for the word "setup". */
const SETUP_LABELS: Record<string, string> = {
  stripe: "Set up billing",
  brevo: "Find my sender",
  openai: "Choose models",
  storage: "Check storage",
};
export default async function IntegrationsPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Integrations")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Connecting services is a platform-level job. You need to be a Briefly super admin to see this.")}</p>
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
        title={tr("Integrations")}
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
                  <IntegrationCard
                    key={integration.key}
                    integration={integration}
                    setupLabel={(SETUP_SUPPORTED as readonly string[]).includes(integration.key) ? SETUP_LABELS[integration.key] : undefined}
                  />
                ))}
            </div>
            {category === "payments" ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {tr("“Set up billing” creates the webhook at")}{" "}<span className="font-mono text-foreground">{webhookUrl}</span>{tr(", stores its signing secret, and gives every priced plan a Stripe product and prices. Run it again after you change a price — it is safe to repeat.")}</p>
            ) : null}
          </section>
        ))}
      </PageBody>
    </>
  );
}
