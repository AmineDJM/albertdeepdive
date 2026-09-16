import Link from "next/link";
import { Suspense } from "react";
import { Newspaper } from "lucide-react";
import { listEditions, nextIssueNumber } from "@/server/editions/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { NewEditionDialog } from "./new-edition-dialog";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function EditionsPage() {
  const user = await getCurrentUser();
  const [editions, next] = await Promise.all([listEditions(), nextIssueNumber()]);
  const now = new Date();
  const nextMonth = now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2;
  const nextYear = now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear();
  return (
    <>
      <PageHeader title="Editions" description="One edition per month. Special issues welcome." actions={hasPermission(user, "edition:create") ? <Suspense><NewEditionDialog nextIssueNumber={next} defaultMonth={nextMonth} defaultYear={nextYear} /></Suspense> : null} />
      <PageBody>
        <DataTable
          rows={editions}
          rowKey={(e) => e.id}
          onRowHref={(e) => `/editions/${e.id}`}
          empty={{ title: "No editions yet", description: "Create the first edition to schedule a contribution campaign.", icon: Newspaper }}
          columns={[
            { key: "issue", header: "Issue", cell: (e) => <span className="tabular font-mono text-xs text-muted-foreground">N°{e.issueNumber}</span>, width: "70px" },
            { key: "label", header: "Edition", cell: (e) => (
                <div>
                  <Link href={`/editions/${e.id}`} className="font-medium hover:underline">
                    {e.label}
                  </Link>
                  <div className="text-2xs text-muted-foreground">{e.title}</div>
                </div>
              ) },
            { key: "status", header: "Status", cell: (e) => <EditionStatusBadge status={e.status} /> },
            { key: "type", header: "Type", cell: (e) => (e.isSpecialIssue ? <Badge variant="outline">Special issue</Badge> : <span className="text-xs text-muted-foreground">Regular</span>) },
            { key: "campaign", header: "Campaign", cell: (e) => { const c = e.campaigns[0]; return c ? <span className="text-xs">{formatDate(c.opensAt)} → {formatDate(c.graceEndsAt)}</span> : <span className="text-xs text-muted-foreground">Not scheduled</span>; } },
            { key: "target", header: "Publication target", cell: (e) => <span className="text-xs">{formatDate(e.publicationTargetAt)}</span> },
            { key: "pages", header: "Pages", cell: (e) => <span className="tabular text-xs">{e.targetPageCount}</span>, align: "right" },
          ]}
        />
      </PageBody>
    </>
  );
}
