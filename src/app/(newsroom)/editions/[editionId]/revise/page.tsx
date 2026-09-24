import { MessagesSquare } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { studioState } from "@/server/editorial/edition-studio/converse";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getUi } from "@/server/i18n/locale";
import { ReviseWorkbench } from "./revise-workbench";

export const dynamic = "force-dynamic";

/**
 * Revise: talking to an issue that is already made.
 *
 * The issue itself is on the page, live, beside the conversation — so "page 6 is nearly empty" is
 * something you can see rather than something you are told. What you ask for lands on a list, and
 * the list is applied in one go, which is what a revision is.
 */
export default async function RevisePage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "layout:edit")) {
    return (
      <>
        <PageHeader title={tr("Revise")} description={tr("Ask for a change to this issue in your own words.")} />
        <PageBody>
          <EmptyState icon={MessagesSquare} title={tr("You can read this issue but not change it")} description={tr("Ask an editor for the rights to change the layout.")} />
        </PageBody>
      </>
    );
  }

  const state = await studioState(editionId);
  const allowance = state.revisions.allowance;
  const left =
    allowance.limit === null
      ? tr("Your plan includes as many revisions as this issue needs.")
      : tr("{used} of {limit} revisions used on this issue.", { used: allowance.used, limit: allowance.limit });

  return (
    <>
      <PageHeader title={tr("Revise")} description={`${state.snapshot.edition.pages} ${tr("pages")} · ${left}`} />
      <PageBody className="space-y-4">
        <ReviseWorkbench editionId={editionId} initial={state} />
      </PageBody>
    </>
  );
}
