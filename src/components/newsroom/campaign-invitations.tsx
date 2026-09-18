"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, MailX, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { CopyButton } from "@/components/settings/copy-button";
import { CampusChip } from "./campus-chip";
import { resendInvitationAction } from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import { formatZoned } from "@/lib/campaigns/schedule";
import { enumLabel } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type InvitationItem = {
  requestId: string;
  contributorId: string;
  name: string;
  email: string;
  campusName: string | null;
  campusColour: string | null;
  status: string;
  sentAt: string | null;
  openedAt: string | null;
  submittedAt: string | null;
  remindedCount: number;
  lastRemindedAt: string | null;
  submissionsCount: number;
  tokenExpiresAt: string;
  tokenExpired: boolean;
  link: string;
};

const STATUS_TONE: Record<string, React.ComponentProps<typeof Badge>["variant"]> = {
  PENDING: "muted",
  SENT: "info",
  OPENED: "brand",
  SUBMITTED: "success",
  DECLINED: "secondary",
  EXPIRED: "warning",
  BOUNCED: "destructive",
};

const VIEWS = [
  { key: "all", label: "Everyone" },
  { key: "silent", label: "Silent" },
  { key: "SUBMITTED", label: "Submitted" },
  { key: "OPENED", label: "Opened" },
  { key: "DECLINED", label: "Declined" },
];

export function CampaignInvitations({ editionId, rows, canResend }: { editionId: string; rows: InvitationItem[]; canResend: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [view, setView] = useState("all");
  const [campus, setCampus] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const campuses = useMemo(() => [...new Set(rows.map((r) => r.campusName).filter((n): n is string => !!n))].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.name} ${r.email}`.toLowerCase().includes(q)) return false;
      if (campus !== "all" && (r.campusName ?? "—") !== campus) return false;
      if (view === "silent") return r.status !== "SUBMITTED" && r.status !== "DECLINED";
      if (view !== "all" && r.status !== view) return false;
      return true;
    });
  }, [rows, query, view, campus]);

  function resend(requestId: string) {
    setBusyId(requestId);
    start(async () => {
      const res = await resendInvitationAction(editionId, requestId);
      setBusyId(null);
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  if (!rows.length) {
    return (
      <EmptyState
        icon={MailX}
        title={tr("Nobody has been invited yet")}
        description={tr("Launching the campaign selects contributors from the chosen pools and emails each one a personal link.")}
        compact
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Search name or email…")} className="h-8 w-56 pl-8" aria-label={tr("Search invitations")} />
        </div>
        <NativeSelect value={view} onChange={(e) => setView(e.target.value)} aria-label={tr("Invitation status")} className="w-auto min-w-32 pr-8">
          {VIEWS.map((v) => (
            <option key={v.key} value={v.key}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
        {campuses.length > 1 ? (
          <NativeSelect value={campus} onChange={(e) => setCampus(e.target.value)} aria-label={tr("Campus")} className="w-auto min-w-32 pr-8">
            <option value="all">{tr("All campuses")}</option>
            {campuses.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        ) : null}
        <span className="tabular text-2xs text-muted-foreground">
          {filtered.length} {" "}{tr("of")}{" "}{rows.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{tr("Contributor")}</TableHead>
              <TableHead>{tr("Campus")}</TableHead>
              <TableHead>{tr("Status")}</TableHead>
              <TableHead>{tr("Activity")}</TableHead>
              <TableHead>{tr("Personal link")}</TableHead>
              <TableHead className="text-right">{tr("Actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.requestId}>
                <TableCell className="py-1.5">
                  <Link href={`/contributors/${r.contributorId}`} className="font-medium hover:text-brand hover:underline">
                    {r.name}
                  </Link>
                  <div className="text-2xs text-muted-foreground">{r.email}</div>
                </TableCell>
                <TableCell className="py-1.5">
                  {r.campusName ? <CampusChip name={r.campusName} colour={r.campusColour} size="xs" /> : <span className="text-2xs text-muted-foreground">{tr("School-wide")}</span>}
                </TableCell>
                <TableCell className="py-1.5">
                  <Badge variant={STATUS_TONE[r.status] ?? "muted"}>{tr(enumLabel(r.status))}</Badge>
                  {r.submissionsCount ? <span className="tabular ml-1.5 text-2xs text-muted-foreground">{r.submissionsCount} {" "}{tr("sent")}</span> : null}
                </TableCell>
                <TableCell className="py-1.5 text-2xs text-muted-foreground">
                  {r.submittedAt ? (
                    <span>{tr("Submitted")}{" "}{formatZoned(r.submittedAt)}</span>
                  ) : r.openedAt ? (
                    <span>{tr("Opened")}{" "}{formatZoned(r.openedAt)}</span>
                  ) : r.sentAt ? (
                    <span>{tr("Sent")}{" "}{formatZoned(r.sentAt)}</span>
                  ) : (
                    <span>{tr("Not sent yet")}</span>
                  )}
                  {r.remindedCount ? (
                    <div>
                      {r.remindedCount} {" "}{tr("reminder")}{r.remindedCount === 1 ? "" : "s"}
                      {r.lastRemindedAt ? ` · last ${formatZoned(r.lastRemindedAt)}` : ""}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="py-1.5" data-no-row-link>
                  <div className="flex items-center gap-1.5">
                    <code className="max-w-[240px] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" title={r.link}>
                      {r.link.replace(/^https?:\/\//, "")}
                    </code>
                    <CopyButton value={r.link} size="icon-xs" label={`Copy the contribution link of ${r.name}`} />
                    <Button asChild variant="ghost" size="icon-xs" aria-label={`Open the contribution form of ${r.name}`}>
                      <a href={r.link} target="_blank" rel="noreferrer">
                        <ExternalLink />
                      </a>
                    </Button>
                  </div>
                  <div className="text-2xs text-muted-foreground">
                    {r.tokenExpired ? <span className="text-warning">{tr("Link expired — resend to renew")}</span> : `Valid until ${formatZoned(r.tokenExpiresAt)}`}
                  </div>
                </TableCell>
                <TableCell className="py-1.5 text-right" data-no-row-link>
                  {canResend ? (
                    <Button variant="outline" size="xs" onClick={() => resend(r.requestId)} loading={pending && busyId === r.requestId} disabled={pending && busyId !== r.requestId}>
                      <Send /> {" "}{tr("Resend")}</Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length === 0 ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">{tr("No invitation matches these filters.")}</p> : null}
      </div>
    </div>
  );
}
