import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { listNarrations, narrationUrl, speechOverview } from "@/server/speech/service";
import { listVoiceClones } from "@/server/speech/clones";
import { SectionTitle } from "@/components/newsroom/page-header";
import { NarrationComposer } from "@/components/newsroom/narration-composer";
import { NarrationList, type NarrationView } from "@/components/newsroom/narration-list";
import { getUi } from "@/server/i18n/locale";

/**
 * A film's voice-over.
 *
 * Made from the scenes' own words, timed to each scene, and mixed into the film the moment it is
 * ready — the video above is encoded again with the voice under it.
 */
export async function PackNarration({ packId, organizationId, publicationId, canPublish }: { packId: string; organizationId: string; publicationId: string | null; canPublish: boolean }) {
  const tr = await getUi();
  const [overview, narrations, clones, publication] = await Promise.all([
    speechOverview(organizationId),
    listNarrations({ packId }),
    listVoiceClones(organizationId),
    publicationId ? db.query.publications.findFirst({ where: eq(s.publications.id, publicationId), columns: { language: true } }) : Promise.resolve(null),
  ]);
  const views: NarrationView[] = await Promise.all(
    narrations.map(async (narration) => ({
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
      url: narration.status === "READY" ? ((await narrationUrl(narration.id))?.url ?? null) : null,
      takeUrls: [],
      chapters: [],
      qa: narration.qa,
      publishedAt: narration.publishedAt?.toISOString() ?? null,
      error: narration.error,
      passages: narration.script?.passages.map((passage) => ({ index: passage.index, plain: passage.plain, speaker: passage.speaker, chapter: passage.chapter ?? null })) ?? [],
      costCents: Number(narration.costCents),
      canPublish: false && canPublish,
    })),
  );
  return (
    <div className="space-y-3">
      <SectionTitle>{tr("Voice-over")}</SectionTitle>
      <p className="text-xs leading-5 text-muted-foreground">{tr("Spoken over the scenes, timed to each one. The film is encoded again with the voice as soon as it is ready.")}</p>
      <NarrationComposer target={{ packId }} fixedKind="VIDEO" overview={overview} clones={clones.filter((clone) => clone.status === "READY").map((clone) => ({ id: clone.id, name: clone.name }))} publicationLanguage={publication?.language ?? null} approved />
      {views.length ? <NarrationList narrations={views} /> : null}
    </div>
  );
}
