import { notFound } from "next/navigation";
import { AudioLines, Clock, Mic } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getEdition } from "@/server/editions/service";
import { requireTenant } from "@/server/tenancy/context";
import { listNarrations, narrationUrl, speechOverview } from "@/server/speech/service";
import { articlesForPicker } from "@/server/speech/sources";
import { listVoiceClones } from "@/server/speech/clones";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { NarrationComposer } from "@/components/newsroom/narration-composer";
import { NarrationList, type NarrationView } from "@/components/newsroom/narration-list";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const APPROVED = new Set(["LAYOUT", "FINAL_REVIEW", "PUBLISHED", "ARCHIVED"]);

/**
 * Listen to this edition.
 *
 * The whole issue, a digest, a briefing or one article — read by a voice native to the language
 * the title publishes in. Made here, checked here, published to readers here.
 */
export default async function AudioPage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const user = await getCurrentUser();
  const edition = await getEdition(editionId).catch(() => null);
  if (!edition || !user) notFound();
  const tenant = await requireTenant();
  const [overview, narrations, articles, clones, publication] = await Promise.all([
    speechOverview(tenant.organizationId),
    listNarrations({ editionId }),
    articlesForPicker(editionId),
    listVoiceClones(tenant.organizationId),
    edition.publicationId ? db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId), columns: { language: true } }) : Promise.resolve(null),
  ]);
  const canPublish = hasPermission(user, "edition:publish");
  const views: NarrationView[] = await Promise.all(
    narrations.map(async (narration) => {
      const link = narration.status === "READY" ? await narrationUrl(narration.id) : null;
      const takeUrls = narration.status === "READY" ? await Promise.all(narration.takes.map(async (take) => ({ take: take.take, url: (await narrationUrl(narration.id, { take: take.take }))?.url ?? "" }))) : [];
      return {
        id: narration.id,
        title: narration.title,
        kind: narration.kind,
        quality: narration.quality,
        status: narration.status,
        language: narration.language,
        languageSource: narration.languageSource,
        voiceName: narration.voiceName,
        durationSeconds: narration.durationSeconds,
        createdAt: narration.createdAt.toISOString(),
        url: link?.url ?? null,
        takeUrls: takeUrls.filter((take) => take.url),
        chapters: narration.chapters,
        qa: narration.qa,
        publishedAt: narration.publishedAt?.toISOString() ?? null,
        error: narration.error,
        passages: narration.script?.passages.map((passage) => ({ index: passage.index, plain: passage.plain, speaker: passage.speaker, chapter: passage.chapter ?? null })) ?? [],
        costCents: Number(narration.costCents),
        canPublish,
      };
    }),
  );
  const ready = narrations.filter((narration) => narration.status === "READY");
  const minutesReady = Math.round(ready.reduce((total, narration) => total + (narration.durationSeconds ?? 0), 0) / 60);
  const usedMinutes = Math.round(overview.allowance.usedSeconds / 60);
  const canRun = hasPermission(user, "export:run");

  return (
    <>
      <PageHeader title={tr("Audio")} description={tr("Listen to this edition: the whole issue, a digest, a briefing or one article, read aloud by a voice native to its language.")} />
      <PageBody className="space-y-6">
        <StatGrid columns={3}>
          <Stat label={tr("Narrations")} value={ready.length} hint={ready.length ? `${minutesReady} ${tr("minutes of audio")}` : tr("none yet")} icon={AudioLines} hue="violet" />
          <Stat label={tr("Minutes this month")} value={overview.allowance.limitMinutes === null ? usedMinutes : `${usedMinutes} / ${overview.allowance.limitMinutes}`} hint={overview.allowance.limitMinutes === null ? tr("unlimited on your plan") : tr("across every narration in the workspace")} icon={Clock} hue="amber" />
          <Stat label={tr("Voice")} value={overview.available.final ? tr("Ready") : overview.available.preview ? tr("Preview only") : tr("Not connected")} hint={overview.available.final ? tr("premium voices for the final") : tr("ask your administrator")} icon={Mic} hue={overview.available.final ? "green" : "coral"} />
        </StatGrid>

        {canRun ? (
          <section className="space-y-3">
            <SectionTitle>{tr("Make a narration")}</SectionTitle>
            <NarrationComposer target={{ editionId }} articles={articles} overview={overview} clones={clones.filter((clone) => clone.status === "READY").map((clone) => ({ id: clone.id, name: clone.name }))} publicationLanguage={publication?.language ?? null} approved={APPROVED.has(edition.status)} />
          </section>
        ) : null}

        <section className="space-y-3">
          <SectionTitle>{tr("Narrations")}</SectionTitle>
          {views.length ? <NarrationList narrations={views} /> : <EmptyState icon={AudioLines} title={tr("Nothing to listen to yet")} description={tr("Make one above. A preview takes a minute or two; the premium voice a little longer.")} />}
        </section>
      </PageBody>
    </>
  );
}
