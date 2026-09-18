import Link from "next/link";
import { Suspense } from "react";
import { Eye, EyeOff, Newspaper } from "lucide-react";
import { listEditions, nextIssueNumber } from "@/server/editions/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { WORKBENCH_TABS } from "@/components/newsroom/nav";
import { DataTable, type Column } from "@/components/newsroom/data-table";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { SelectAll, SelectRow, SelectionProvider } from "@/components/newsroom/selection";
import { NewEditionDialog } from "./new-edition-dialog";
import { EditionsBulkBar } from "./editions-bulk-bar";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function EditionsPage({ searchParams }: { searchParams: Promise<{ hidden?: string }> }) {
  const tr = await getUi();
  const [user, sp] = await Promise.all([getCurrentUser(), searchParams]);
  const [all, next] = await Promise.all([listEditions({ includeHidden: true }), nextIssueNumber()]);
  // Hidden editions stay out of the way until asked for, and are marked when they are.
  const showHidden = sp.hidden === "1";
  const editions = showHidden ? all : all.filter((edition) => !edition.hiddenAt);
  const hiddenCount = all.length - all.filter((edition) => !edition.hiddenAt).length;
  const canManage = hasPermission(user, "edition:edit");
  const canDelete = hasPermission(user, "edition:archive");

  const now = new Date();
  const nextMonth = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
  const nextYear = now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear();

  type Row = (typeof editions)[number];
  const columns: Column<Row>[] = [
    ...(canManage ? [{ key: "select", header: <SelectAll ids={editions.map((e) => e.id)} />, cell: (e: Row) => <SelectRow id={e.id} label={e.label} />, width: "36px" }] : []),
    { key: "issue", header: tr("Issue"), cell: (e) => <span className="tabular font-mono text-xs text-muted-foreground">N°{e.issueNumber}</span>, width: "70px" },
    {
      key: "label",
      header: tr("Edition"),
      cell: (e) => (
        <div>
          <span className="flex items-center gap-2">
            <Link href={`/editions/${e.id}`} className="font-medium hover:underline">
              {e.label}
            </Link>
            {e.hiddenAt ? <Badge variant="muted">{tr("Hidden")}</Badge> : null}
          </span>
          <div className="text-2xs text-muted-foreground">{e.title}</div>
        </div>
      ),
    },
    { key: "status", header: tr("Status"), cell: (e) => <EditionStatusBadge status={e.status} /> },
    { key: "type", header: tr("Type"), cell: (e) => (e.isSpecialIssue ? <Badge variant="outline">{tr("Special issue")}</Badge> : <span className="text-xs text-muted-foreground">{tr("Regular")}</span>) },
    {
      key: "campaign",
      header: tr("Campaign"),
      cell: (e) => {
        const c = e.campaigns[0];
        return c ? (
          <span className="text-xs">
            {formatDate(c.opensAt)} → {formatDate(c.graceEndsAt)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">{tr("Not scheduled")}</span>
        );
      },
    },
    { key: "target", header: tr("Publication target"), cell: (e) => <span className="text-xs">{formatDate(e.publicationTargetAt)}</span> },
    { key: "pages", header: tr("Pages"), cell: (e) => <span className="tabular text-xs">{e.targetPageCount}</span>, align: "right" },
  ];

  return (
    <>
      <PageHeader
        title={tr("Editions")}
        description={tr("One edition per month. Special issues welcome.")}
        actions={
          hasPermission(user, "edition:create") ? (
            <Suspense>
              <NewEditionDialog nextIssueNumber={next} defaultMonth={nextMonth} defaultYear={nextYear} />
            </Suspense>
          ) : null
        }
      >
        <HubTabs tabs={WORKBENCH_TABS} />
      </PageHeader>
      <PageBody className="space-y-3">
        {hiddenCount || showHidden ? (
          <div className="flex justify-end">
            <Button asChild variant="ghost" size="sm">
              <Link href={showHidden ? "/editions" : "/editions?hidden=1"}>
                {showHidden ? <EyeOff /> : <Eye />}
                {showHidden ? "Tuck hidden editions away" : `Show ${hiddenCount} hidden`}
              </Link>
            </Button>
          </div>
        ) : null}
        <SelectionProvider>
          {canManage ? <EditionsBulkBar canDelete={canDelete} /> : null}
          <DataTable
            rows={editions}
            rowKey={(e) => e.id}
            onRowHref={(e) => `/editions/${e.id}`}
            empty={{ title: showHidden ? "Nothing hidden" : "No editions yet", description: showHidden ? "Every edition is in the list." : "Create the first edition to schedule a contribution campaign.", icon: Newspaper }}
            columns={columns}
          />
        </SelectionProvider>
      </PageBody>
    </>
  );
}
