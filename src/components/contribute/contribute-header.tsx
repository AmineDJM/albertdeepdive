"use client";

import { CalendarClock, Check, CloudOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveStatus = { status: "idle" | "saving" | "saved" | "error"; at?: Date };

export function ContributeHeader({
  firstName,
  campusName,
  deadlineLabel,
  introMessage,
  saveStatus,
  compact,
}: {
  firstName: string;
  campusName: string | null;
  deadlineLabel: string;
  introMessage: string | null;
  saveStatus: SaveStatus;
  compact?: boolean;
}) {
  return (
    <div className={cn("mb-6 space-y-3", compact && "mb-4")}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="font-display text-[30px] leading-[1.1] font-semibold tracking-tight text-primary sm:text-[36px]">
            Hi {firstName}
            {campusName ? <span className="text-brand-foreground/80">, {campusName}</span> : null}
          </h1>
          {!compact ? <p className="mt-2 max-w-prose text-[15px] text-muted-foreground">{introMessage?.trim() || "Tell us what happened around you this month. It takes about five minutes and the newsroom does the writing."}</p> : null}
        </div>
        <SaveIndicator status={saveStatus} />
      </div>
      <span className="inline-flex h-9 items-center gap-2 rounded-full border border-warning/40 bg-warning-soft px-3 text-[13px] font-medium text-foreground">
        <CalendarClock className="size-4 text-warning" />
        Deadline {deadlineLabel}
      </span>
    </div>
  );
}

export function SaveIndicator({ status }: { status: SaveStatus }) {
  const time = status.at ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(status.at) : null;
  return (
    <span className="inline-flex h-7 items-center gap-1.5 text-[13px] text-muted-foreground" aria-live="polite" role="status">
      {status.status === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" /> Saving…
        </>
      ) : status.status === "saved" ? (
        <>
          <Check className="size-3.5 text-success" /> Saved{time ? ` · ${time}` : ""}
        </>
      ) : status.status === "error" ? (
        <>
          <CloudOff className="size-3.5 text-destructive" /> Not saved — retrying
        </>
      ) : (
        <span className="text-muted-foreground/70">Drafts save automatically</span>
      )}
    </span>
  );
}
