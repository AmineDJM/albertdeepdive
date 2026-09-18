import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { gmailStatus } from "@/server/email/gmail";
import { oauthConfigured, redirectUri } from "@/server/email/google-oauth";
import { mailFacets } from "@/server/settings/read-logs";
import { env } from "@/server/env";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { GmailConnection } from "@/components/settings/gmail-connection";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Button } from "@/components/ui/button";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <NoAccess title={tr("Email")} permission="settings:manage" />;
  const [status, facets] = await Promise.all([gmailStatus(), mailFacets()]);

  return (
    <>
      <PageHeader
        title={tr("Email")}
        description={tr("One mailbox does the whole job: invitations out, replies in. Nothing is configured in the environment.")}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href="/settings/mailbox">
              {tr("Mailbox log")}{" "}<ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <PageBody className="space-y-5">
        <StatGrid columns={3}>
          <Stat label={tr("Sending through")} value={status.connected ? (status.mode === "oauth" ? "Google" : "Gmail") : env.EMAIL_PROVIDER === "resend" ? "Resend" : "Nothing yet"} hint={status.address ?? "Connect a mailbox below"} tone={status.connected ? "success" : "warning"} />
          <Stat label={tr("Messages sent")} value={facets.total} hint={facets.failed ? `${facets.failed} failed` : "None failed"} href="/settings/mailbox" />
          <Stat label={tr("Replies")} value={status.receiveEnabled ? "Collected" : "Not collected"} hint={status.lastPolledAt ? `Last checked ${new Date(status.lastPolledAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : "Never checked"} />
        </StatGrid>

        <section>
          <SectionTitle>{tr("Connection")}</SectionTitle>
          <GmailConnection status={status} appName={env.APP_NAME} oauthAvailable={oauthConfigured()} oauthRedirectUri={redirectUri()} result={sp.gmail ?? null} />
        </section>

        <p className="text-2xs leading-relaxed text-muted-foreground">
          {tr("Secrets — the app password or the Google refresh token — are encrypted with the application secret before they are written to the database, and never shown again. Replies are checked on the hourly automation tick, and on demand from this screen. A reply from someone who is not a contributor is left in the mailbox untouched.")}</p>
      </PageBody>
    </>
  );
}
