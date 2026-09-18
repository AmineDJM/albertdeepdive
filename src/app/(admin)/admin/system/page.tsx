import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { describeEnvironment } from "@/server/settings/environment";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Badge } from "@/components/ui/badge";
import { KeyValueList } from "@/components/settings/key-value";
import { Housekeeping } from "../housekeeping";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

function Mode({ value, tone = "brand" }: { value: string; tone?: "brand" | "muted" | "success" | "warning" }) {
  return <Badge variant={tone}>{value}</Badge>;
}

/** The runtime this Briefly runs on, read-only, and the one chore the platform does for itself. */
export default async function SystemPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <PageHeader title={tr("System")} />;
  const environment = describeEnvironment();
  return (
    <>
      <PageHeader title={tr("System")} description={tr("Provider modes come from the environment; secrets are never shown here or anywhere.")} />
      <PageBody className="space-y-6">
        <section className="rounded-lg border border-border bg-card p-4">
          <SectionTitle>{tr("Environment")}</SectionTitle>
          <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
            <KeyValueList
              rows={[
                { label: tr("App"), value: `${environment.app.name} · ${environment.app.nodeEnv}` },
                { label: tr("URL"), value: environment.app.url, mono: true },
                { label: tr("AI"), value: <span className="flex flex-wrap items-center gap-1.5"><Mode value={environment.ai.provider} />{environment.ai.provider === "openai" ? environment.ai.apiKeyConfigured ? <Mode value={tr("key configured")} tone="success" /> : <Mode value={tr("no API key — falls back to local")} tone="warning" /> : null}</span> },
                { label: tr("Models"), value: <span className="font-mono text-xs">{environment.ai.modelFast} / {environment.ai.modelStrong}</span> },
                { label: tr("Email"), value: <Mode value={environment.email.effectiveProvider === "resend" ? "Resend" : tr("dev mailbox (log)")} tone={environment.email.effectiveProvider === "resend" ? "success" : "muted"} /> },
                { label: tr("From"), value: environment.email.from, mono: true },
              ]}
            />
            <KeyValueList
              rows={[
                { label: tr("Storage"), value: <span className="flex flex-wrap items-center gap-1.5"><Mode value={environment.storage.provider === "s3" ? "S3-compatible" : tr("local disk")} tone={environment.storage.provider === "s3" ? "success" : "muted"} /><span className="font-mono text-xs">{environment.storage.provider === "s3" ? `${environment.storage.bucket ?? "bucket?"} · ${environment.storage.region}` : environment.storage.localDir}</span></span> },
                { label: tr("Signed URLs"), value: `${environment.storage.signedUrlTtlSeconds} s` },
                { label: tr("Jobs"), value: <span className="flex flex-wrap items-center gap-1.5"><Mode value={environment.jobs.runner} tone={environment.jobs.runner === "none" ? "warning" : "brand"} /><span className="text-2xs text-muted-foreground">{tr("poll every")} {environment.jobs.pollIntervalMs} {tr("ms")}</span></span> },
                { label: tr("Uploads"), value: `${environment.uploads.maxFileMb} MB · ${environment.uploads.maxFilesPerSubmission} ${tr("files per submission")}` },
                { label: tr("Print"), value: <span className="flex flex-wrap items-center gap-1.5">{environment.print.pageSize}{environment.print.chromiumConfigured ? <Mode value={tr("Chromium configured")} tone="success" /> : <Mode value={tr("bundled Chromium")} tone="muted" />}</span> },
                { label: tr("Sessions"), value: `${environment.session.ttlDays} ${tr("days")}` },
              ]}
            />
          </div>
        </section>
        <section>
          <SectionTitle>{tr("Housekeeping")}</SectionTitle>
          <Housekeeping />
        </section>
      </PageBody>
    </>
  );
}
