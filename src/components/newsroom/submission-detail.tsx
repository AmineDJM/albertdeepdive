"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Check, CircleSlash, Copy, ExternalLink, FileQuestion, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { SubmissionStatusBadge, RightsBadge, SeverityBadge } from "@/components/newsroom/status-badge";
import { CampusList } from "@/components/newsroom/campus-chip";
import { commentOnSubmissionAction, reprocessSubmissionAction, reviewSubmissionAction } from "@/app/(newsroom)/editions/[editionId]/inbox/actions";
import { formatDateTime, enumLabel, relativeTime } from "@/lib/utils";
import { storyTypeLabel } from "@/lib/constants";
import type { ReviewStatus } from "@/server/editorial/submissions";
import { useUi } from "@/components/i18n/provider";

export type SubmissionDetailData = {
  submission: {
    id: string;
    title: string;
    description: string;
    status: string;
    storyType: string;
    campusScope: string;
    eventDateText: string | null;
    peopleInvolved: string | null;
    organisationsInvolved: string | null;
    whyItMatters: string | null;
    quotes: string | null;
    urls: string[];
    extra: Record<string, unknown>;
    aiSummary: string | null;
    aiImportance: number | null;
    aiWarnings: { code: string; message: string; severity: string }[];
    aiEntities: { people?: { name: string; role?: string }[]; organisations?: { name: string; type?: string }[]; metrics?: { label: string; value: string }[] } | null;
    normalizedText: string | null;
    wordCount: number;
    publicationConsent: boolean;
    imageRightsConfirmed: boolean;
    processedAt: Date | null;
    submittedAt: Date | null;
    createdAt: Date;
    reviewNote: string | null;
    contactEmail: string | null;
  };
  contributorName: string;
  campusList: { id: string; name: string; colour: string | null }[];
  media: { id: string; url: string | null; caption: string | null; rightsStatus: "GREEN" | "YELLOW" | "RED"; fileName: string; kind: string }[];
  cluster: { id: string; title: string; status: string } | null;
  duplicateOf: { id: string; title: string; status: string } | null;
  stories: { id: string; title: string; status: string }[];
  comments: { id: string; body: string; createdAt: Date; userName: string | null }[];
  infoRequests: { id: string; status: string; message: string; createdAt: Date; answeredAt: Date | null }[];
};

const ACTIONS: { status: ReviewStatus; label: string; icon: React.ComponentType<{ className?: string }>; variant?: "outline" | "default" }[] = [
  { status: "ACCEPTED", label: "Accept", icon: Check, variant: "default" },
  { status: "POTENTIAL_STORY", label: "Potential", icon: Sparkles },
  { status: "MISSING_INFO", label: "Missing info", icon: FileQuestion },
  { status: "DUPLICATE", label: "Duplicate", icon: Copy },
  { status: "REJECTED", label: "Reject", icon: CircleSlash },
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div>
      <div className="label-caps">{label}</div>
      <div className="mt-0.5 text-[13px] whitespace-pre-wrap">{children}</div>
    </div>
  );
}

export function SubmissionDetail({ editionId, data, canReview, onClose }: { editionId: string; data: SubmissionDetailData; canReview: boolean; onClose?: string }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState("");
  const sub = data.submission;
  const extraEntries = Object.entries(sub.extra ?? {}).filter(([, v]) => v !== null && v !== "" && v !== undefined);

  function review(status: ReviewStatus) {
    startTransition(async () => {
      const res = await reviewSubmissionAction(editionId, sub.id, status);
      if (res.ok) {
        toast.success(res.message);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <SubmissionStatusBadge status={sub.status} />
            <Badge variant="outline">{storyTypeLabel(sub.storyType)}</Badge>
            {sub.aiImportance !== null ? <Badge variant="muted">{tr("importance")}{" "}{Math.round(sub.aiImportance * 100)}</Badge> : null}
          </div>
          <h2 className="mt-1 text-sm font-semibold">{sub.title}</h2>
          <p className="text-2xs text-muted-foreground">
            {data.contributorName} · {formatDateTime(sub.submittedAt ?? sub.createdAt)} · {sub.wordCount}{" "}{tr("words")}</p>
        </div>
        {onClose ? (
          <Button size="icon-sm" variant="ghost" asChild aria-label={tr("Close")}>
            <Link href={onClose} scroll={false}>
              <X />
            </Link>
          </Button>
        ) : null}
      </div>

      {canReview ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2">
          {ACTIONS.map((a) => (
            <Button key={a.status} size="xs" variant={a.variant ?? "outline"} disabled={pending} onClick={() => review(a.status)}>
              <a.icon /> {a.label}
            </Button>
          ))}
          <Button
            size="xs"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await reprocessSubmissionAction(editionId, sub.id);
                if (res.ok) {
                  toast.success(res.message);
                  router.refresh();
                } else toast.error(res.error);
              })
            }
          >
            <RefreshCw />{" "}{tr("Reprocess")}</Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 scrollbar-thin">
        {sub.aiWarnings.length ? (
          <ul className="space-y-1">
            {sub.aiWarnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                <AlertTriangle className={w.severity === "error" ? "mt-0.5 size-3.5 shrink-0 text-destructive" : w.severity === "warning" ? "mt-0.5 size-3.5 shrink-0 text-warning" : "mt-0.5 size-3.5 shrink-0 text-muted-foreground"} />
                <span className="flex-1">{w.message}</span>
                <SeverityBadge severity={w.severity as "info" | "warning" | "error"} />
              </li>
            ))}
          </ul>
        ) : null}

        {data.duplicateOf ? (
          <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs">
            {tr("Marked as a duplicate of")}{" "}
            <Link href={`/editions/${editionId}/inbox?submission=${data.duplicateOf.id}`} className="font-medium underline">
              {data.duplicateOf.title}
            </Link>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("Campuses")}>
            <CampusList campuses={data.campusList} max={6} />
          </Field>
          <Field label={tr("Date")}>{sub.eventDateText ?? "—"}</Field>
        </div>

        <Field label={tr("What happened")}>{sub.description}</Field>
        <Field label={tr("People involved")}>{sub.peopleInvolved}</Field>
        <Field label={tr("Organisations")}>{sub.organisationsInvolved}</Field>
        <Field label={tr("Why it matters")}>{sub.whyItMatters}</Field>
        <Field label={tr("Quotes")}>{sub.quotes}</Field>

        {sub.urls.length ? (
          <div>
            <div className="label-caps">{tr("Links")}</div>
            <ul className="mt-0.5 space-y-0.5">
              {sub.urls.map((u) => (
                <li key={u}>
                  <a href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
                    {u} <ExternalLink className="size-3" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {extraEntries.length ? (
          <div>
            <div className="label-caps">{tr("Structured answers")}</div>
            <dl className="mt-1 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)]">
              {extraEntries.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{tr(enumLabel(k.replace(/([A-Z])/g, " $1")))}</dt>
                  <dd className="whitespace-pre-wrap">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {data.media.length ? (
          <div>
            <div className="label-caps">{tr("Photos & files (")}{data.media.length})</div>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.media.map((m) => (
                <Link key={m.id} href={`/media/${m.id}`} className="group block overflow-hidden rounded-md border border-border">
                  {m.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.url} alt={m.caption ?? ""} className="aspect-[4/3] w-full object-cover transition-transform group-hover:scale-[1.02]" />
                  ) : (
                    <div className="flex aspect-[4/3] items-center justify-center bg-muted text-2xs text-muted-foreground">{tr("No preview")}</div>
                  )}
                  <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                    <span className="truncate text-2xs">{m.caption || m.fileName}</span>
                    <RightsBadge status={m.rightsStatus} showLabel={false} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {sub.aiEntities ? (
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="label-caps">{tr("Extracted by AI")}</div>
            <div className="mt-1.5 space-y-1 text-xs">
              {sub.aiEntities.people?.length ? (
                <p>
                  <span className="text-muted-foreground">{tr("People:")}</span>
                  {sub.aiEntities.people.map((p) => p.name).join(", ")}
                </p>
              ) : null}
              {sub.aiEntities.organisations?.length ? (
                <p>
                  <span className="text-muted-foreground">{tr("Organisations:")}</span>
                  {sub.aiEntities.organisations.map((o) => o.name).join(", ")}
                </p>
              ) : null}
              {sub.aiEntities.metrics?.length ? (
                <p>
                  <span className="text-muted-foreground">{tr("Metrics:")}</span>
                  {sub.aiEntities.metrics.map((m) => `${m.label}: ${m.value}`).join(" · ")}
                </p>
              ) : null}
              {!sub.processedAt ? <p className="text-muted-foreground">{tr("Not processed yet.")}</p> : null}
            </div>
          </div>
        ) : null}

        <Separator />

        <div className="space-y-2">
          <div className="label-caps">{tr("Where this goes")}</div>
          {data.cluster ? (
            <Link href={`/editions/${editionId}/stories?cluster=${data.cluster.id}`} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-brand/50">
              <span className="truncate">{tr("Cluster:")}{" "}{data.cluster.title}</span>
              <ArrowUpRight className="size-3.5 shrink-0" />
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">{tr("Not clustered yet.")}</p>
          )}
          {data.stories.map((st) => (
            <Link key={st.id} href={`/stories/${st.id}`} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs hover:border-brand/50">
              <span className="truncate">{tr("Story:")}{" "}{st.title}</span>
              <ArrowUpRight className="size-3.5 shrink-0" />
            </Link>
          ))}
        </div>

        {data.infoRequests.length ? (
          <div>
            <div className="label-caps">{tr("Information requests")}</div>
            <ul className="mt-1 space-y-1">
              {data.infoRequests.map((r) => (
                <li key={r.id} className="rounded-md border border-border px-2.5 py-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={r.status === "ANSWERED" ? "success" : "info"}>{tr(enumLabel(r.status))}</Badge>
                    <span className="text-2xs text-muted-foreground">{relativeTime(r.answeredAt ?? r.createdAt)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-muted-foreground">{r.message}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <div className="label-caps">{tr("Consent")}</div>
          <div className="mt-1 flex gap-1.5">
            <Badge variant={sub.publicationConsent ? "success" : "destructive"}>{sub.publicationConsent ? "Publication consent" : "No publication consent"}</Badge>
            <Badge variant={sub.imageRightsConfirmed ? "success" : "warning"}>{sub.imageRightsConfirmed ? "Image rights confirmed" : "Image rights unconfirmed"}</Badge>
          </div>
        </div>

        <div>
          <div className="label-caps">{tr("Notes")}</div>
          {data.comments.map((c) => (
            <div key={c.id} className="mt-1 rounded-md border border-border px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.userName ?? "Someone"}</span>
                <span className="text-2xs text-muted-foreground">{relativeTime(c.createdAt)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
          {canReview ? (
            <form
              className="mt-2 space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!comment.trim()) return;
                startTransition(async () => {
                  const res = await commentOnSubmissionAction(editionId, sub.id, comment);
                  if (res.ok) {
                    setComment("");
                    toast.success(res.message);
                    router.refresh();
                  } else toast.error(res.error);
                });
              }}
            >
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder={tr("Add a note for the desk…")} className="text-xs" />
              <Button size="xs" type="submit" variant="outline" loading={pending} disabled={!comment.trim()}>
                {tr("Add note")}</Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
