import { Palette } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { designState } from "@/server/design/console";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getUi } from "@/server/i18n/locale";
import { DesignWorkbench } from "./design-workbench";

export const dynamic = "force-dynamic";

/**
 * The design, and everything that changes it.
 *
 * §28 of the design brief: the high-level controls first, the advanced ones behind them, and the
 * issue itself on the page while you use either. Every control here goes through the same engine
 * the conversation does, so "make the pictures bigger" and dragging the photography dial are two
 * ways of saying one thing rather than two code paths that will disagree by Christmas.
 */
export default async function DesignPage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const user = await getCurrentUser();

  if (!hasPermission(user, "layout:edit")) {
    return (
      <>
        <PageHeader title={tr("Design")} description={tr("How this issue looks, and why.")} />
        <PageBody>
          <EmptyState icon={Palette} title={tr("You can read this issue but not change how it looks")} description={tr("Ask an editor for the rights to change the layout.")} />
        </PageBody>
      </>
    );
  }

  const state = await designState(editionId);
  return (
    <>
      <PageHeader title={tr("Design")} description={state.design ? state.intent : tr("This edition has not been designed yet.")} />
      <PageBody className="space-y-4">
        <DesignWorkbench editionId={editionId} initial={state} />
      </PageBody>
    </>
  );
}
