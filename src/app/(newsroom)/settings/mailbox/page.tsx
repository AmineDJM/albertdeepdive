import { Suspense } from "react";
import { Mail } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listMail, mailFacets } from "@/server/settings/read-logs";
import { listEditions } from "@/server/editions/service";
import { env } from "@/server/env";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { MailboxList } from "@/components/settings/mailbox-list";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { enumLabel } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function MailboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "audit:view")) return <NoAccess title={tr("Mailbox")} permission="audit:view" />;

  const [rows, facets, editions] = await Promise.all([
    listMail({ template: sp.template, status: sp.status, editionId: sp.editionId, q: sp.q }),
    mailFacets(),
    listEditions(),
  ]);

  const isLog = env.EMAIL_PROVIDER === "log";

  return (
    <>
      <PageHeader
        title={tr("Mailbox")}
        description={
          isLog
            ? "Every message the newsroom has sent. The provider is “log”, so nothing left the building — read here what a contributor would have received, personal link included."
            : `Every message the newsroom has sent, through “${env.EMAIL_PROVIDER}”.`
        }
      />
      <PageBody className="space-y-5">
        <StatGrid columns={3}>
          <Stat label={tr("Messages")} value={facets.total} hint={`Provider: ${env.EMAIL_PROVIDER}`} />
          <Stat label={tr("Failed")} value={facets.failed} tone={facets.failed ? "destructive" : "success"} hint={facets.failed ? "Needs attention" : "Nothing to resend"} />
          <Stat label={tr("Templates")} value={facets.templates.length} hint={tr("Invitations, reminders, alerts")} tone="brand" />
        </StatGrid>

        <Suspense>
          <FilterBar
            searchPlaceholder={tr("Search recipient or subject…")}
            filters={[
              { key: "template", label: tr("Template"), options: facets.templates.map((t) => ({ value: t, label: enumLabel(t) })) },
              { key: "status", label: tr("Status"), options: facets.statuses.map((s) => ({ value: s, label: enumLabel(s) })) },
              { key: "editionId", label: tr("Edition"), options: editions.map((e) => ({ value: e.id, label: e.label })) },
            ]}
          />
        </Suspense>

        <section>
          <SectionTitle>
            {tr("Messages")}{" "}<span className="tabular ml-1.5 font-normal text-muted-foreground">{rows.length} {" "}{tr("most recent")}</span>
          </SectionTitle>
          {rows.length ? (
            <MailboxList messages={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), sentAt: r.sentAt?.toISOString() ?? null }))} />
          ) : (
            <EmptyState icon={Mail} title={tr("No message yet")} description={tr("Launch a campaign and the invitations will appear here.")} />
          )}
        </section>
      </PageBody>
    </>
  );
}
