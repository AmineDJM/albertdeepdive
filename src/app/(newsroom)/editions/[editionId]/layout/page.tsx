import { LayoutGrid } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { FLATPLAN_TEMPLATES, getFlatplan } from "@/server/publication/flatplan";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { EmptyState } from "@/components/ui/empty-state";
import { FlatplanBoard } from "@/components/newsroom/flatplan-board";
import { FlatplanReport } from "@/components/newsroom/flatplan-report";
import { FlatplanRunningOrder } from "@/components/newsroom/flatplan-running-order";
import { FlatplanToolbar } from "@/components/newsroom/flatplan-toolbar";
import { getUi } from "@/server/i18n/locale";
import { newsletterForEdition } from "@/server/publication/naming";

export const dynamic = "force-dynamic";

/**
 * Flatplan: the whole issue as a grid of spreads. The persisted page plan (what goes where) is
 * merged with the print engine's copyfit pass (how the text really flows), so the editor sees the
 * pages the printer will see, including the continuation pages the paginator adds.
 */
export default async function FlatplanPage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const user = await getCurrentUser();
  const canEdit = hasPermission(user, "layout:edit");
  const flatplan = await getFlatplan(editionId);
  const { stats, report, edition, plan } = flatplan;
  // The masthead that goes on the cover sheet of the plan.
  const newsletter = await newsletterForEdition(editionId);

  return (
    <>
      <PageHeader
        title={tr("Flatplan")}
        description={`${stats.pages} pages · ${stats.spreads} spreads · ${stats.plannedPages} planned + ${stats.continuationPages} continuation · ${edition.pageSize}`}
        actions={canEdit ? <FlatplanToolbar editionId={editionId} lockedPages={stats.lockedPages} planned={stats.plannedPages} planStatus={(flatplan.plan?.status as "DRAFT" | "VALIDATED" | "LOCKED") ?? "DRAFT"} /> : null}
      />
      <PageBody className="space-y-4">
        {!flatplan.pages.length ? (
          <EmptyState
            icon={LayoutGrid}
            title={plan ? "The page plan is empty" : "This edition has no page plan yet"}
            description={
              canEdit
                ? "Run “Re-plan pages” to build the flatplan from the sections and the selected stories: cover, contents, one page per story, Business Deep Dives kept together and a back page."
                : "An editor has to build the page plan before the issue can be laid out."
            }
            action={canEdit ? <FlatplanToolbar editionId={editionId} lockedPages={0} planned={0} onlyPlan /> : null}
          />
        ) : (
          <>
            <StatGrid columns={6}>
              <Stat label={tr("Pages")} value={stats.pages} hint={`${stats.plannedPages} planned · ${stats.continuationPages} continuation`} />
              <Stat label={tr("Spreads")} value={stats.spreads} hint={stats.signaturePadding ? `${stats.signaturePadding} more page${stats.signaturePadding === 1 ? "" : "s"} for a full signature` : "a clean multiple of four"} tone={stats.signaturePadding ? "warning" : "success"} />
              <Stat label={tr("Target")} value={edition.targetPageCount} hint={stats.pages > edition.targetPageCount ? `${stats.pages - edition.targetPageCount} over target` : "pages planned for this issue"} tone={stats.pages > edition.targetPageCount ? "warning" : "muted"} />
              <Stat label={tr("Average fill")} value={`${Math.round(stats.fill * 100)}%`} hint={`${stats.words.toLocaleString("en-GB")} words on the pages`} tone={stats.fill >= 0.8 ? "success" : stats.fill >= 0.5 ? "default" : "warning"} />
              <Stat label={tr("Locked")} value={stats.lockedPages} hint={tr("pages re-planning will not move")} tone={stats.lockedPages ? "brand" : "muted"} />
              <Stat
                label={tr("Warnings")}
                value={stats.errors + stats.warnings}
                hint={stats.errors ? `${stats.errors} blocking · ${stats.warnings} to check` : `${stats.warnings} to check · ${stats.infos} notes`}
                tone={stats.errors ? "destructive" : stats.warnings ? "warning" : "success"}
              />
            </StatGrid>

            <FlatplanReport flatplan={flatplan} />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_272px]">
              <FlatplanBoard
                editionId={editionId}
                publicationName={newsletter.name} editionLabel={edition.label}
                issueLabel={edition.issueLabel}
                pages={flatplan.pages}
                stories={flatplan.stories}
                templates={FLATPLAN_TEMPLATES}
                canEdit={canEdit}
              />
              <aside className="xl:sticky xl:top-16 xl:self-start">
                <FlatplanRunningOrder editionId={editionId} sectionRuns={flatplan.sectionRuns} stories={flatplan.stories} canEdit={canEdit} />
                {report ? (
                  <p className="mt-3 text-2xs text-muted-foreground">
                    {tr("Plan “")}{plan?.name}” · {plan?.status.toLowerCase()} · {stats.images}{" "}{tr("images available on the planned pages.")}</p>
                ) : null}
              </aside>
            </div>
          </>
        )}
      </PageBody>
    </>
  );
}
