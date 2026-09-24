import { notFound } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getEdition } from "@/server/editions/service";
import { topicsBoard } from "@/server/editorial/topics";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { TopicsBoard } from "./topics-board";
import { DocumentImport } from "./document-import";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { JOB_TYPES } from "@/server/jobs/registry";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * The step between what arrived and what gets written.
 *
 * An editor here is not editing a newsletter — there isn't one yet — they are deciding what the
 * newsletter is going to be about. Everything on this screen serves that one question, and the
 * button at the bottom is the moment the issue stops being a list of decisions and becomes
 * something to read.
 */
export default async function TopicsPage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const [user, edition] = await Promise.all([getCurrentUser(), getEdition(editionId).catch(() => null)]);
  if (!edition || !user) notFound();

  const board = await topicsBoard(editionId);
  const canEdit = hasPermission(user, "story:edit");
  // A document still being turned into topics, so the screen can say so and watch for them.
  const [reading] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.jobs)
    .where(and(eq(s.jobs.type, JOB_TYPES.TOPICS_FROM_DOCUMENT), inArray(s.jobs.status, ["QUEUED", "RUNNING"]), sql`${s.jobs.payload}->>'editionId' = ${editionId}`));

  return (
    <>
      <PageHeader
        title={tr("Topics")}
        description={tr("What came in, grouped and deduplicated. Keep what belongs in the issue, leave the rest, and nothing is written until you build the draft.")}
      />
      <PageBody className="space-y-5">
        {/*
          * Four zeros are not a summary of anything.
          *
          * On a new edition nothing has come in yet, and a row reading "0 · 0 · 0 · 0" tells the
          * person setting it up that they are behind on work that has not started. The counters
          * appear with the first topic, which is also the first moment they mean something.
          */}
        {board.topics.length ? (
          <StatGrid columns={4}>
            <Stat label={tr("To decide")} value={String(board.counts.waiting)} tone={board.counts.waiting ? "warning" : "default"} />
            <Stat label={tr("In the issue")} value={String(board.counts.kept)} hint={`${board.counts.drafted} ${tr("written")}`} />
            <Stat label={tr("Left out")} value={String(board.counts.left)} hint={tr("kept on file, not in this issue")} />
            <Stat label={tr("Contributions behind them")} value={String(board.topics.reduce((sum, topic) => sum + topic.sources, 0))} />
          </StatGrid>
        ) : null}
        {canEdit ? <DocumentImport editionId={editionId} reading={Number(reading?.n ?? 0) > 0} /> : null}
        <TopicsBoard board={board} canEdit={canEdit} />
      </PageBody>
    </>
  );
}
