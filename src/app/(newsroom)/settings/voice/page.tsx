import { AudioLines, Clock, Mic } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { getBrandVoice, speechOverview } from "@/server/speech/service";
import { listVoiceClones } from "@/server/speech/clones";
import { speechConfig } from "@/server/speech/providers";
import { resolveCatalogue } from "@/lib/speech/voices";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { NoAccess } from "@/components/settings/no-access";
import { BrandVoiceForm, type BrandVoiceValues } from "./brand-voice-form";
import { VoiceClones } from "./voice-clones";
import { currentLocale, getUi } from "@/server/i18n/locale";
import type { Accent, Pace, Style } from "@/lib/speech/types";

export const dynamic = "force-dynamic";

/**
 * The workspace's voice.
 *
 * What every narration starts from — a voice, a style, a pace — and the words said the newsroom's
 * way. Cloning sits at the bottom, behind the plan's switch and the platform's, and behind consent.
 */
export default async function VoiceSettingsPage() {
  const tr = await getUi();
  const locale = await currentLocale();
  const user = await getCurrentUser();
  const tenant = await requireTenant();
  const allowed = tenant.role === "OWNER" || tenant.role === "ADMIN" || hasPermission(user, "settings:manage");
  if (!allowed) return <NoAccess title={tr("Voice")} permission="settings:manage" />;

  const [overview, brandVoice, clones, config] = await Promise.all([speechOverview(tenant.organizationId), getBrandVoice(tenant.organizationId), listVoiceClones(tenant.organizationId), speechConfig()]);
  const voices = resolveCatalogue(config.voiceCatalogue)
    .filter((entry) => entry.providerVoiceId)
    .map((entry) => ({ key: entry.voice.key, label: entry.voice.label[locale], language: entry.voice.language }));
  const values: BrandVoiceValues = {
    voiceKey: brandVoice?.voiceKey ?? null,
    gender: (brandVoice?.gender as BrandVoiceValues["gender"]) ?? "auto",
    accent: (brandVoice?.accent as Accent) ?? "auto",
    style: (brandVoice?.style as Style) ?? "editorial",
    pace: (brandVoice?.pace as Pace) ?? "natural",
    language: brandVoice?.language ?? null,
    pronunciations: brandVoice?.pronunciations ?? [],
    cloneId: brandVoice?.cloneId ?? null,
  };
  const readyClones = clones.filter((clone) => clone.status === "READY").map((clone) => ({ id: clone.id, name: clone.name }));
  const usedMinutes = Math.round(overview.allowance.usedSeconds / 60);

  return (
    <>
      <PageHeader title={tr("Voice")} description={tr("How your editions sound when they are read aloud, and how your names are said.")} />
      <PageBody className="space-y-6">
        <StatGrid columns={3}>
          <Stat label={tr("Narration")} value={overview.features.audioNarration ? (overview.available.final ? tr("Ready") : overview.available.preview ? tr("Preview only") : tr("Not connected")) : tr("Not in your plan")} hint={overview.features.audioNarration ? tr("from any edition's Audio tab") : tr("upgrade to have editions read aloud")} icon={Mic} hue={overview.available.final && overview.features.audioNarration ? "green" : "amber"} />
          <Stat label={tr("Minutes this month")} value={overview.allowance.limitMinutes === null ? usedMinutes : `${usedMinutes} / ${overview.allowance.limitMinutes}`} hint={overview.allowance.limitMinutes === null ? tr("unlimited on your plan") : tr("across every narration in the workspace")} icon={Clock} hue="amber" />
          <Stat label={tr("Languages")} value={overview.languages.length} hint={tr("with a native voice set up")} icon={AudioLines} hue="violet" />
        </StatGrid>

        <section className="space-y-3 rounded-lg border border-border bg-card p-4">
          <SectionTitle>{tr("House voice")}</SectionTitle>
          <BrandVoiceForm values={values} voices={voices} languages={overview.languages} clones={readyClones} />
        </section>

        <section className="space-y-3">
          <SectionTitle>{tr("A real person's voice")}</SectionTitle>
          {overview.features.voiceCloning && overview.cloningEnabled ? (
            <VoiceClones clones={clones.map((clone) => ({ id: clone.id, name: clone.name, personName: clone.personName, relation: clone.relation, status: clone.status, consentGrantedAt: clone.consentGrantedAt.toISOString(), error: clone.error, language: clone.language }))} languages={overview.languages} />
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              {overview.features.voiceCloning ? tr("Voice cloning is switched off on this Briefly.") : tr("Cloning a real person's voice — with their consent — is not included in your plan.")}
            </p>
          )}
        </section>
      </PageBody>
    </>
  );
}
