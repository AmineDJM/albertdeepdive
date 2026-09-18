import { Mails } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { enumLabel, formatDateTime } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export type EmailLogItem = {
  id: string;
  to: string;
  subject: string;
  template: string | null;
  status: string;
  provider: string | null;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
  contributorName: string | null;
};

const TEMPLATE_LABELS: Record<string, string> = {
  campaign_invitation: "Invitation",
  campaign_reminder: "Reminder",
  campaign_reminder_1: "Reminder #1",
  campaign_reminder_2: "Reminder #2",
  campaign_grace: "Last call",
  campaign_closed: "Thank you",
  editorial_alert: "Editorial alert",
  low_coverage_alert: "Coverage alert",
  deadline_alert: "Deadline alert",
  information_request: "Information request",
};

function statusVariant(status: string): React.ComponentProps<typeof Badge>["variant"] {
  if (status === "FAILED") return "destructive";
  if (status === "QUEUED") return "info";
  if (status === "LOGGED") return "muted";
  return "success";
}

/** Every email this edition's campaign produced — in development the provider only logs them. */
export async function CampaignEmailLog({ rows, provider }: { rows: EmailLogItem[]; provider: string }) {
  const tr = await getUi();
  if (!rows.length) {
    return (
      <EmptyState
        icon={Mails}
        title={tr("No email has been sent for this edition")}
        description={tr("Invitations, reminders and thank-you notes all appear here once the campaign runs.")}
        compact
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[132px]">{tr("When")}</TableHead>
            <TableHead>{tr("Recipient")}</TableHead>
            <TableHead>{tr("Subject")}</TableHead>
            <TableHead className="w-[120px]">{tr("Type")}</TableHead>
            <TableHead className="w-[120px]">{tr("Status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="tabular py-1.5 text-2xs text-muted-foreground">{formatDateTime(r.sentAt ?? r.createdAt)}</TableCell>
              <TableCell className="py-1.5">
                <div className="truncate">{r.contributorName ?? r.to}</div>
                {r.contributorName ? <div className="text-2xs text-muted-foreground">{r.to}</div> : null}
              </TableCell>
              <TableCell className="py-1.5">
                <div className="truncate">{r.subject}</div>
                {r.error ? <div className="text-2xs text-destructive">{r.error}</div> : null}
              </TableCell>
              <TableCell className="py-1.5 text-2xs text-muted-foreground">{r.template ? (TEMPLATE_LABELS[r.template] ?? enumLabel(r.template)) : "—"}</TableCell>
              <TableCell className="py-1.5">
                <Badge variant={statusVariant(r.status)}>{r.status === "LOGGED" ? "Logged" : enumLabel(r.status)}</Badge>
                {r.status === "LOGGED" ? null : <span className="ml-1.5 text-2xs text-muted-foreground">{r.provider ?? provider}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
