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

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <NoAccess title="Privacy & retention" permission="settings:manage" />;
  const settings = await getSystemSettings();
  const summary = await retentionSummary(settings.privacy.retentionDays);
  return (
    <>
      <PageHeader title="Privacy & retention" description="Contributors trust the newsroom with their names, photos and stories. This is where that trust is kept." />
      <PageBody className="max-w-4xl space-y-4">
        <RetentionForm key={settings.privacy.retentionDays} retentionDays={settings.privacy.retentionDays} summary={summary} />
        <SettingsCard id="consent" title="Consent texts" description="What contributors agree to when they submit. The version is stamped on every consent record.">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
            <dl className="space-y-3 text-[13px]">
              <div>
                <dt className="flex items-center gap-2"><span className="font-medium">Publication</span><Badge variant="outline">PUBLICATION</Badge></dt>
                <dd className="mt-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">{CONSENT_TEXTS.PUBLICATION}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-2"><span className="font-medium">Image rights</span><Badge variant="outline">IMAGE_RIGHTS</Badge></dt>
                <dd className="mt-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">{CONSENT_TEXTS.IMAGE_RIGHTS}</dd>
              </div>
            </dl>
            <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
              <div className="label-caps mb-2">Versions in use</div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-success" />
                <span>
                  Current text version <span className="font-mono">{CONSENT_TEXT_VERSION}</span>
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {summary.consentVersions.map((v) => (
                  <li key={v.version} className="flex justify-between gap-3">
                    <span className="font-mono">{v.version}</span>
                    <span className="tabular text-muted-foreground">{v.count} records</span>
                  </li>
                ))}
                {!summary.consentVersions.length ? <li className="text-muted-foreground">No consent records yet.</li> : null}
              </ul>
              <p className="mt-2 text-2xs text-muted-foreground">Texts are versioned in code (src/lib/constants.ts) so a wording change never rewrites past consent.</p>
            </div>
          </div>
        </SettingsCard>
        <SettingsCard id="deletion" title="Deletion requests" description="How a contributor's personal data is removed while the editorial record stays intact.">
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px]">
            <li>Find the contributor in <Link href="/contributors" className="text-brand hover:underline">Contributors</Link> and open their page.</li>
            <li>Use <strong>Anonymise personal data</strong> in the privacy & account zone: name, email, notes and tags are replaced; submissions stay attributed to an anonymised contributor so provenance of published facts is preserved.</li>
            <li>Published issues are not altered — a printed newspaper is a historical record. If a person asks to be removed from a future reprint, edit the article and re-export the version.</li>
            <li>The action is written to the audit log with the requesting administrator.</li>
          </ol>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link href="/contributors">
              Open contributors <ArrowRight />
            </Link>
          </Button>
        </SettingsCard>
        <ExportTool />
      </PageBody>
    </>
  );
}
