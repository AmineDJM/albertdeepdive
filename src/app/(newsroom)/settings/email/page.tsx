import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock, Mail, ShieldAlert } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getTenant } from "@/server/tenancy/context";
import { gmailStatus } from "@/server/email/gmail";
import { oauthConfigured, redirectUri } from "@/server/email/google-oauth";
import { checkSendingDomain, getSendingDomain, sendingDomainSuggestion } from "@/server/email/domains";
import { deliveryConfig, envelopeFor, senderIdentity } from "@/server/email/sender";
import { deliveryStats } from "@/server/email/events";
import { env } from "@/server/env";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { GmailConnection } from "@/components/settings/gmail-connection";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DomainConnect } from "./domain-connect";
import { DnsRecords } from "./dns-records";
import { RemoveDomainButton, SenderForm } from "./sender-settings";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Email, from the customer's side.
 *
 * One question answered at the top — what do my readers see when an edition arrives — then the
 * sender, which is the customer's to choose with or without a domain, then the domain. The status
 * is in plain words, the records are copy-and-paste, and the screen looks again on its own. The provider, its keys and its vocabulary stay in the platform
 * console, where the people who run Briefly are.
 */
export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const [user, tenant] = await Promise.all([getCurrentUser(), getTenant()]);
  const platformStaff = hasPermission(user, "settings:manage");
  if (!tenant || !(tenant.role === "OWNER" || tenant.role === "ADMIN" || platformStaff)) return <NoAccess title={tr("Email sending")} permission="settings:manage" />;

  let domain = await getSendingDomain(tenant.organizationId);
  // Looking is free and the customer is here: a domain still on its way is checked on every visit.
  if (domain && domain.status !== "READY") domain = await checkSendingDomain(domain, { minIntervalMs: 60_000 });
  const [config, sender, identity, suggestion, stats, gmail] = await Promise.all([
    deliveryConfig(),
    envelopeFor(tenant.organizationId),
    senderIdentity(tenant.organizationId),
    domain ? Promise.resolve(null) : sendingDomainSuggestion(tenant.organizationId),
    deliveryStats(tenant.organizationId),
    platformStaff ? gmailStatus() : Promise.resolve(null),
  ]);

  const STATUS: Record<string, { label: string; variant: "success" | "warning" | "muted" | "default" | "destructive"; icon: typeof Clock }> = {
    SETTING_UP: { label: tr("Setting up"), variant: "muted", icon: Clock },
    WAITING_FOR_DNS: { label: tr("Waiting for DNS"), variant: "warning", icon: Clock },
    VERIFYING: { label: tr("Verifying"), variant: "default", icon: Clock },
    READY: { label: tr("Ready to send ✓"), variant: "success", icon: CheckCircle2 },
    NEEDS_ATTENTION: { label: tr("Needs attention"), variant: "destructive", icon: ShieldAlert },
  };
  const status = domain ? STATUS[domain.status] : null;
  const description =
    sender.mode === "domain"
      ? tr("Your editions and invitations go out from your own domain.")
      : sender.transport === "log"
        ? tr("Email delivery is not connected on this Briefly yet; messages are kept in the mailbox log until it is.")
        : tr("Your editions go out under your name from Briefly's sending address until your own domain is ready.");
  const rate = (part: number) => (stats.sent ? `${Math.round((part / stats.sent) * 100)}%` : "—");

  return (
    <>
      <PageHeader
        title={tr("Email sending")}
        description={description}
        actions={
          platformStaff ? (
            <Button size="sm" variant="outline" asChild>
              <Link href="/settings/mailbox">
                {tr("Mailbox log")}{" "}<ArrowUpRight />
              </Link>
            </Button>
          ) : undefined
        }
      />
      <PageBody className="space-y-6">
        <StatGrid columns={3}>
          <Stat
            label={tr("Sending as")}
            value={<span className="text-[15px]">{sender.name}</span>}
            hint={
              <>
                <span className="block break-all font-mono">{sender.address}</span>
                {sender.mode === "domain" ? tr("your own domain") : <span className="text-warning">{tr("your name, on Briefly's sending address")}</span>}
              </>
            }
            icon={Mail}
            hue={sender.mode === "domain" ? "green" : "amber"}
          />
          <Stat label={tr("Delivered, 30 days")} value={rate(stats.delivered)} hint={`${stats.sent} ${tr("sent")} · ${stats.bounced} ${tr("bounced")} · ${stats.complained} ${tr("complaints")}`} hue={stats.bounced + stats.complained > 0 ? "coral" : "teal"} />
          <Stat label={tr("Opened, 30 days")} value={rate(stats.opened)} hint={`${stats.opened} ${tr("opened")} · ${stats.clicked} ${tr("clicked")}`} hue="violet" />
        </StatGrid>

        <section className="space-y-3">
          <SectionTitle>{tr("Sender")}</SectionTitle>
          <SenderForm
            workspaceName={identity.workspaceName}
            customName={identity.customName}
            replyTo={identity.replyTo}
            sharedAddress={sender.address}
            domain={domain ? { name: domain.domainName, localPart: domain.senderLocalPart, ready: domain.status === "READY" && sender.mode === "domain" } : null}
            repliesUnread={sender.mode === "shared" && sender.transport === "resend"}
          />
        </section>

        <section className="space-y-3">
          <SectionTitle>{tr("Your domain")}</SectionTitle>
          {!domain ? (
            <DomainConnect suggestion={suggestion} senderName={identity.name} configured={config.configured} />
          ) : (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                {status ? (
                  <Badge variant={status.variant} className="gap-1 px-2 py-1 text-xs">
                    <status.icon className="size-3.5" />{" "}{status.label}</Badge>
                ) : null}
                <span className="font-mono text-[14px] font-medium">{domain.domainName}</span>
              </div>

              {domain.status === "READY" ? (
                <p className="text-xs leading-5 text-muted-foreground">{tr("Everything you send goes out from this domain. Bounces and complaints are handled for you; a reader who bounces is not written to again.")}</p>
              ) : (
                <DnsRecords domain={{ status: domain.status, domainName: domain.domainName, rootDomain: domain.rootDomain, records: domain.records, dnsHost: domain.dnsHost, dnsHostUrl: domain.dnsHostUrl, oneClickUrl: domain.oneClickUrl, lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null, lastError: domain.lastError }} />
              )}

              <div className="flex justify-end border-t border-border pt-3">
                <RemoveDomainButton />
              </div>
            </div>
          )}
        </section>

        {platformStaff && gmail ? (
          <details className="rounded-lg border border-dashed border-border p-4">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">{tr("Platform: mailbox for replies")}</summary>
            <div className="mt-4 space-y-4">
              <p className="max-w-prose text-xs leading-5 text-muted-foreground">{tr("A connected mailbox collects replies to invitations and sends when no delivery provider is connected. Customers never see this.")}</p>
              <GmailConnection status={gmail} appName={env.APP_NAME} oauthAvailable={oauthConfigured()} oauthRedirectUri={redirectUri()} result={sp.gmail ?? null} />
            </div>
          </details>
        ) : null}
      </PageBody>
    </>
  );
}
