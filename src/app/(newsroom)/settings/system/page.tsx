import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getSystemSettings } from "@/server/settings/service";
import { describeEnvironment } from "@/server/settings/environment";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Badge } from "@/components/ui/badge";
import { KeyValueList, SettingsCard } from "@/components/settings/key-value";
import { NoAccess } from "@/components/settings/no-access";
import { AiForm, AutomationsForm, CampaignDefaultsForm, ContactForm, MastheadForm, PrintForm } from "./system-forms";

export const dynamic = "force-dynamic";

function Mode({ value, tone = "brand" }: { value: string; tone?: "brand" | "muted" | "success" | "warning" }) {
  return <Badge variant={tone}>{value}</Badge>;
}

export default async function SystemSettingsPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <NoAccess title="System" permission="settings:manage" />;
  const [settings, environment] = await Promise.all([getSystemSettings(), Promise.resolve(describeEnvironment())]);
  const stamp = (key: keyof typeof settings.meta) => settings.meta[key]?.updatedAt?.toISOString() ?? "0";
  return (
    <>
      <PageHeader title="System" description="Publication identity, the monthly rhythm, print and AI defaults, automation toggles and the runtime environment." />
      <PageBody className="max-w-4xl space-y-4">
        <MastheadForm key={`m-${stamp("masthead")}`} value={settings.masthead} />
        <ContactForm key={`c-${stamp("contact")}`} value={settings.contact} />
        <CampaignDefaultsForm key={`cd-${stamp("campaign_defaults")}`} value={settings.campaignDefaults} />
        <PrintForm key={`p-${stamp("print")}`} value={settings.print} />
        <AiForm key={`ai-${stamp("ai")}`} value={settings.ai} provider={environment.ai.provider} modelFast={environment.ai.modelFast} modelStrong={environment.ai.modelStrong} />
        <AutomationsForm key={`a-${stamp("automations")}`} value={settings.automations} />
        <SettingsCard id="environment" title="Environment" description="Read-only. Provider modes come from environment variables; secrets are never shown.">
          <div className="grid gap-x-8 gap-y-2 md:grid-cols-2">
            <KeyValueList
              rows={[
                { label: "App", value: `${environment.app.name} · ${environment.app.nodeEnv}` },
                { label: "URL", value: environment.app.url, mono: true },
                { label: "AI", value: <span className="flex flex-wrap items-center gap-1.5"><Mode value={environment.ai.provider} /> {environment.ai.provider === "openai" ? (environment.ai.apiKeyConfigured ? <Mode value="key configured" tone="success" /> : <Mode value="no API key — falls back to local" tone="warning" />) : <span className="text-2xs text-muted-foreground">deterministic, never invents facts</span>}</span> },
                { label: "Models", value: <span className="font-mono text-xs">{environment.ai.modelFast} / {environment.ai.modelStrong}</span> },
                { label: "Email", value: <span className="flex flex-wrap items-center gap-1.5"><Mode value={environment.email.effectiveProvider === "resend" ? "Resend" : "dev mailbox (log)"} tone={environment.email.effectiveProvider === "resend" ? "success" : "muted"} /> {environment.email.provider === "resend" && !environment.email.apiKeyConfigured ? <Mode value="RESEND_API_KEY missing" tone="warning" /> : null}</span> },
                { label: "From", value: environment.email.from, mono: true },
              ]}
            />
            <KeyValueList
              rows={[
                { label: "Storage", value: <span className="flex flex-wrap items-center gap-1.5"><Mode value={environment.storage.provider === "s3" ? "S3-compatible" : "local disk"} tone={environment.storage.provider === "s3" ? "success" : "muted"} /><span className="font-mono text-xs">{environment.storage.provider === "s3" ? `${environment.storage.bucket ?? "bucket?"} · ${environment.storage.region}${environment.storage.customEndpoint ? " · custom endpoint" : ""}` : environment.storage.localDir}</span></span> },
                { label: "Signed URLs", value: `${environment.storage.signedUrlTtlSeconds} s` },
                { label: "Jobs", value: <span className="flex flex-wrap items-center gap-1.5"><Mode value={environment.jobs.runner} tone={environment.jobs.runner === "none" ? "warning" : "brand"} /><span className="text-2xs text-muted-foreground">poll every {environment.jobs.pollIntervalMs} ms</span></span> },
                { label: "Uploads", value: `${environment.uploads.maxFileMb} MB per file · ${environment.uploads.maxFilesPerSubmission} files per submission` },
                { label: "Print", value: <span className="flex flex-wrap items-center gap-1.5">{environment.print.pageSize}{environment.print.chromiumConfigured ? <Mode value="Chromium configured" tone="success" /> : <Mode value="bundled Chromium" tone="muted" />}</span> },
                { label: "Tick token", value: environment.automations.tickTokenConfigured ? <Mode value="configured" tone="success" /> : <Mode value="default — set AUTOMATION_TICK_TOKEN" tone="warning" /> },
                { label: "Sessions", value: `${environment.session.ttlDays} days` },
              ]}
            />
          </div>
        </SettingsCard>
      </PageBody>
    </>
  );
}
