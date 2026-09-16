"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, CircleSlash, Copy, FileQuestion, Image as ImageIcon, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { SubmissionStatusBadge } from "@/components/newsroom/status-badge";
import { CampusList } from "@/components/newsroom/campus-chip";
import { bulkReviewAction, reviewSubmissionAction } from "@/app/(newsroom)/editions/[editionId]/inbox/actions";
import { cn, formatDateTime, relativeTime, truncate } from "@/lib/utils";
import { storyTypeShort } from "@/lib/constants";
import type { ReviewStatus } from "@/server/editorial/submissions";

export type InboxItem = {
  id: string;
  title: string;
  description: string;
  status: string;
  storyType: string;
  createdAt: Date;
  submittedAt: Date | null;
  aiSummary: string | null;
  aiImportance: number | null;
  processedAt: Date | null;
  contributorName: string;
  campusList: { id: string; name: string; colour: string | null }[];
  mediaCount: number;
  thumbnails: { id: string; url: string | null; rightsStatus: string }[];
  cluster: { id: string; title: string; status: string } | null;
  awaitingInformation: boolean;
  errorCount: number;
  warningCount: number;
  aiWarnings: { code: string; message: string; severity: string }[];
};

const BULK: { status: ReviewStatus; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { status: "ACCEPTED", label: "Accept", icon: Check },
  { status: "POTENTIAL_STORY", label: "Potential story", icon: Sparkles },
  { status: "MISSING_INFO", label: "Missing info", icon: FileQuestion },
  { status: "DUPLICATE", label: "Duplicate", icon: Copy },
  { status: "REJECTED", label: "Reject", icon: CircleSlash },
];

export function InboxList({ editionId, items, selectedId, canReview }: { editionId: string; items: InboxItem[]; selectedId?: string; canReview: boolean }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const ids = useMemo(() => items.map((i) => i.id), [items]);
  const selection = useMemo(() => new Set([...checked].filter((id) => ids.includes(id))), [checked, ids]);

  const toggle = useCallback((id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function runBulk(status: ReviewStatus) {
    const list = [...selection];
    startTransition(async () => {
      const res = await bulkReviewAction(editionId, list, status);
      if (res.ok) {
        toast.success(res.message);
        setChecked(new Set());
        router.refresh();
      } else toast.error(res.error);
    });
  }

  function runSingle(id: string, status: ReviewStatus) {
    startTransition(async () => {
      const res = await reviewSubmissionAction(editionId, id, status);
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  if (!items.length) {
    return <EmptyState icon={RefreshCw} title="Nothing here" description="No submission matches these filters. Clear them, or wait for contributions to arrive." compact />;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ul className="divide-y divide-border overflow-y-auto scrollbar-thin">
        {items.map((item) => {
          const active = item.id === selectedId;
          const isChecked = selection.has(item.id);
          return (
            <li key={item.id} className={cn("group relative", active && "bg-brand-soft/30", isChecked && "bg-accent/40")}>
              <div className="flex gap-2.5 px-3 py-2.5">
                {canReview ? (
                  <span className="pt-0.5" data-no-row-link>
                    <Checkbox checked={isChecked} onCheckedChange={() => toggle(item.id)} aria-label={`Select ${item.title}`} />
                  </span>
                ) : null}
                <Link href={`/editions/${editionId}/inbox?submission=${item.id}`} scroll={false} className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("line-clamp-1 text-[13px] font-medium", active && "text-brand-foreground")}>{item.title}</span>
                    <span className="shrink-0 text-2xs text-muted-foreground" title={formatDateTime(item.submittedAt ?? item.createdAt)}>
                      {relativeTime(item.submittedAt ?? item.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.aiSummary || truncate(item.description, 160)}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <SubmissionStatusBadge status={item.status} />
                    <Badge variant="outline">{storyTypeShort(item.storyType)}</Badge>
                    <CampusList campuses={item.campusList} max={2} />
                    <span className="text-2xs text-muted-foreground">{item.contributorName}</span>
                    {item.mediaCount ? (
                      <span className="inline-flex items-center gap-0.5 text-2xs text-muted-foreground">
                        <ImageIcon className="size-3" /> {item.mediaCount}
                      </span>
                    ) : null}
                    {item.errorCount || item.warningCount ? (
                      <span className={cn("inline-flex items-center gap-0.5 text-2xs", item.errorCount ? "text-destructive" : "text-warning")}>
                        <AlertTriangle className="size-3" /> {item.errorCount + item.warningCount}
                      </span>
                    ) : null}
                    {item.awaitingInformation ? <Badge variant="info">Awaiting answer</Badge> : null}
                    {!item.processedAt ? <Badge variant="muted">Not processed</Badge> : null}
                    {item.cluster ? <span className="truncate text-2xs text-brand">→ {truncate(item.cluster.title, 40)}</span> : null}
                  </div>
                </Link>
                {item.thumbnails.length ? (
                  <div className="hidden shrink-0 gap-1 sm:flex">
                    {item.thumbnails.map((t) =>
                      t.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={t.id} src={t.url} alt="" className="size-11 rounded-sm border border-border object-cover" />
                      ) : null,
                    )}
                  </div>
                ) : null}
              </div>
              {canReview ? (
                <div className="absolute top-2 right-2 hidden gap-1 group-hover:flex" data-no-row-link>
                  <Button size="icon-xs" variant="outline" title="Accept" aria-label="Accept" disabled={pending} onClick={() => runSingle(item.id, "ACCEPTED")}>
                    <Check />
                  </Button>
                  <Button size="icon-xs" variant="outline" title="Reject" aria-label="Reject" disabled={pending} onClick={() => runSingle(item.id, "REJECTED")}>
                    <X />
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {selection.size ? (
        <div className="sticky bottom-0 flex flex-wrap items-center gap-1.5 border-t border-border bg-card/95 px-3 py-2 backdrop-blur">
          <span className="text-xs font-medium">
            {selection.size} selected
            {pending ? <Loader2 className="ml-1.5 inline size-3 animate-spin" /> : null}
          </span>
          {BULK.map((b) => (
            <Button key={b.status} size="xs" variant="outline" disabled={pending} onClick={() => runBulk(b.status)}>
              <b.icon /> {b.label}
            </Button>
          ))}
          <Button size="xs" variant="ghost" onClick={() => setChecked(new Set())}>
            Clear
          </Button>
        </div>
      ) : null}
    </div>
  );
}
