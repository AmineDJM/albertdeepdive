import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getSystemSettings } from "@/server/settings/service";
import { retentionSummary } from "@/server/settings/privacy";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/key-value";
import { NoAccess } from "@/components/settings/no-access";
import { CONSENT_TEXT_VERSION, CONSENT_TEXTS } from "@/lib/constants";
import { ExportTool, RetentionForm } from "./privacy-tools";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <NoAccess title={tr("Privacy & retention")} permission="settings:manage" />;
  const settings = await getSystemSettings();
  const summary = await retentionSummary(settings.privacy.retentionDays);
  return (
    <>
      <PageHeader title={tr("Privacy & retention")} description={tr("Contributors trust the newsroom with their names, photos and stories. This is where that trust is kept.")} />
      <PageBody className="max-w-4xl space-y-4">
        <RetentionForm key={settings.privacy.retentionDays} retentionDays={settings.privacy.retentionDays} summary={summary} />
        <SettingsCard id="consent" title={tr("Consent texts")} description={tr("What contributors agree to when they submit. The version is stamped on every consent record.")}>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <dl className="space-y-3 text-[13px]">
              <div>
                <dt className="flex items-center gap-2"><span className="font-medium">{tr("Publication")}</span><Badge variant="outline">{tr("PUBLICATION")}</Badge></dt>
                <dd className="mt-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">{CONSENT_TEXTS.PUBLICATION}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-2"><span className="font-medium">{tr("Image rights")}</span><Badge variant="outline">{tr("IMAGE_RIGHTS")}</Badge></dt>
                <dd className="mt-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">{CONSENT_TEXTS.IMAGE_RIGHTS}</dd>
              </div>
            </dl>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <div className="label-caps mb-2">{tr("Versions in use")}</div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-success" />
                <span>
                  {tr("Current text version")}{" "}<span className="font-mono">{CONSENT_TEXT_VERSION}</span>
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {summary.consentVersions.map((v) => (
                  <li key={v.version} className="flex justify-between gap-3">
                    <span className="font-mono">{v.version}</span>
                    <span className="tabular text-muted-foreground">{v.count} {" "}{tr("records")}</span>
                  </li>
                ))}
                {!summary.consentVersions.length ? <li className="text-muted-foreground">{tr("No consent records yet.")}</li> : null}
              </ul>
              <p className="mt-2 text-2xs text-muted-foreground">{tr("Texts are versioned in code (src/lib/constants.ts) so a wording change never rewrites past consent.")}</p>
            </div>
          </div>
        </SettingsCard>
        <SettingsCard id="deletion" title={tr("Deletion requests")} description={tr("How a contributor's personal data is removed while the editorial record stays intact.")}>
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px]">
            <li>{tr("Find the contributor in")}{" "}<Link href="/contributors" className="text-brand hover:underline">{tr("Contributors")}</Link> {" "}{tr("and open their page.")}</li>
            <li>{tr("Use")}{" "}<strong>{tr("Anonymise personal data")}</strong> {" "}{tr("in the privacy & account zone: name, email, notes and tags are replaced; submissions stay attributed to an anonymised contributor so provenance of published facts is preserved.")}</li>
            <li>{tr("Published issues are not altered — a printed newspaper is a historical record. If a person asks to be removed from a future reprint, edit the article and re-export the version.")}</li>
            <li>{tr("The action is written to the audit log with the requesting administrator.")}</li>
          </ol>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link href="/contributors">
              {tr("Open contributors")}{" "}<ArrowRight />
            </Link>
          </Button>
        </SettingsCard>
        <ExportTool />
      </PageBody>
    </>
  );
}
