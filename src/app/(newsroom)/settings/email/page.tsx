import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock, Mail, ShieldAlert } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getTenant } from "@/server/tenancy/context";
import { gmailStatus } from "@/server/email/gmail";
import { oauthConfigured, redirectUri } from "@/server/email/google-oauth";
import { checkSendingDomain, getSendingDomain, sendingDomainSuggestion } from "@/server/email/domains";
import { deliveryConfig, senderFor } from "@/server/email/sender";
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
import { SenderSettings } from "./sender-settings";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Email, from the customer's side.
 *
 * One question answered at the top — what do my readers see when an edition arrives — and one
 * thing to do: connect a domain. The status is in plain words, the records are copy-and-paste, and
 * the screen looks again on its own. The provider, its keys and its vocabulary stay in the platform
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
  const [config, sender, suggestion, stats, gmail] = await Promise.all([
    deliveryConfig(),
    senderFor(tenant.organizationId),
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
      : sender.mode === "test"
        ? tr("Your editions go out “via Briefly” until your own domain is ready — real mail, plainly marked as not yet yours.")
        : config.configured
          ? tr("Connect your domain to send as yourself.")
          : tr("Email delivery is not connected on this Briefly yet; messages are kept in the mailbox log until it is.");
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
            value={<span className="text-[15px] break-all">{sender.from}</span>}
            hint={sender.mode === "domain" ? tr("your own domain") : sender.mode === "test" ? <span className="text-warning">{tr("test mode — via Briefly")}</span> : tr("Briefly's own address")}
            icon={Mail}
            hue={sender.mode === "domain" ? "green" : sender.mode === "test" ? "amber" : "cobalt"}
          />
          <Stat label={tr("Delivered, 30 days")} value={rate(stats.delivered)} hint={`${stats.sent} ${tr("sent")} · ${stats.bounced} ${tr("bounced")} · ${stats.complained} ${tr("complaints")}`} hue={stats.bounced + stats.complained > 0 ? "coral" : "teal"} />
          <Stat label={tr("Opened, 30 days")} value={rate(stats.opened)} hint={`${stats.opened} ${tr("opened")} · ${stats.clicked} ${tr("clicked")}`} hue="violet" />
        </StatGrid>

        <section className="space-y-3">
          <SectionTitle>{tr("Your domain")}</SectionTitle>
          {!domain ? (
            <DomainConnect suggestion={suggestion} organizationName={tenant.name} configured={config.configured} />
          ) : (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                {status ? (
                  <Badge variant={status.variant} className="gap-1 px-2 py-1 text-xs">
                    <status.icon className="size-3.5" />{" "}{status.label}</Badge>
                ) : null}
                <span className="font-mono text-[14px] font-medium">{domain.domainName}</span>
                {domain.status === "READY" ? (
                  <span className="text-xs text-muted-foreground">
                    {tr("Your readers see")}{" "}<span className="font-medium text-foreground">{domain.senderName}</span>{" "}<span className="font-mono">&lt;{domain.senderLocalPart}@{domain.domainName}&gt;</span>
                  </span>
                ) : null}
              </div>

              {domain.status === "READY" ? (
                <p className="text-xs leading-5 text-muted-foreground">{tr("Everything you send goes out from this domain. Bounces and complaints are handled for you; a reader who bounces is not written to again.")}</p>
              ) : (
                <DnsRecords domain={{ status: domain.status, domainName: domain.domainName, rootDomain: domain.rootDomain, records: domain.records, dnsHost: domain.dnsHost, dnsHostUrl: domain.dnsHostUrl, oneClickUrl: domain.oneClickUrl, lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null, lastError: domain.lastError }} />
              )}

              <details className="group border-t border-border pt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">{tr("Advanced settings")}</summary>
                <div className="mt-3">
                  <SenderSettings domain={{ domainName: domain.domainName, senderName: domain.senderName, senderLocalPart: domain.senderLocalPart, replyTo: domain.replyTo }} />
                </div>
              </details>
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
