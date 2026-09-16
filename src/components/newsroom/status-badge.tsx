import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type EditionStatus } from "@/lib/editorial/edition-state";
import { RIGHTS_STATUS_LABELS } from "@/lib/constants";
import { enumLabel } from "@/lib/utils";

type Variant = React.ComponentProps<typeof Badge>["variant"];

const editionTone: Record<EditionStatus, Variant> = {
  UPCOMING: "muted",
  OPEN: "success",
  REMINDER_1: "success",
  REMINDER_2: "success",
  GRACE_PERIOD: "warning",
  CLOSED: "secondary",
  PROCESSING: "info",
  EDITORIAL_REVIEW: "brand",
  LAYOUT: "brand",
  FINAL_REVIEW: "warning",
  PUBLISHED: "default",
  ARCHIVED: "muted",
};

export function EditionStatusBadge({ status }: { status: EditionStatus }) {
  return <Badge variant={editionTone[status]}>{STATUS_LABELS[status]}</Badge>;
}

const storyTone: Record<string, Variant> = { CANDIDATE: "muted", SELECTED: "brand", DRAFTING: "info", IN_REVIEW: "warning", APPROVED: "success", REJECTED: "destructive", PUBLISHED: "default", DROPPED: "muted" };
export function StoryStatusBadge({ status }: { status: string }) {
  return <Badge variant={storyTone[status] ?? "muted"}>{enumLabel(status)}</Badge>;
}

const articleTone: Record<string, Variant> = { EMPTY: "muted", AI_DRAFT: "info", IN_EDITING: "brand", READY_FOR_REVIEW: "warning", APPROVED: "success", LOCKED: "default" };
const articleLabel: Record<string, string> = { EMPTY: "No draft", AI_DRAFT: "AI draft", IN_EDITING: "In editing", READY_FOR_REVIEW: "Ready for review", APPROVED: "Approved", LOCKED: "Locked" };
export function ArticleStatusBadge({ status }: { status: string }) {
  return <Badge variant={articleTone[status] ?? "muted"}>{articleLabel[status] ?? enumLabel(status)}</Badge>;
}

const submissionTone: Record<string, Variant> = { DRAFT: "muted", NEW: "info", NEEDS_REVIEW: "warning", MISSING_INFO: "warning", DUPLICATE: "secondary", POTENTIAL_STORY: "brand", ACCEPTED: "success", REJECTED: "destructive", ARCHIVED: "muted" };
export function SubmissionStatusBadge({ status }: { status: string }) {
  return <Badge variant={submissionTone[status] ?? "muted"}>{enumLabel(status)}</Badge>;
}

const clusterTone: Record<string, Variant> = { PROPOSED: "info", CONFIRMED: "success", MERGED: "muted", DISMISSED: "muted" };
export function ClusterStatusBadge({ status }: { status: string }) {
  return <Badge variant={clusterTone[status] ?? "muted"}>{enumLabel(status)}</Badge>;
}

export function RightsBadge({ status, showLabel = true }: { status: "GREEN" | "YELLOW" | "RED"; showLabel?: boolean }) {
  const variant: Variant = status === "GREEN" ? "success" : status === "YELLOW" ? "warning" : "destructive";
  return (
    <Badge variant={variant} className="gap-1">
      <span className={`size-1.5 rounded-full ${status === "GREEN" ? "bg-success" : status === "YELLOW" ? "bg-warning" : "bg-destructive"}`} />
      {showLabel ? RIGHTS_STATUS_LABELS[status] : null}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: "info" | "warning" | "error" | "low" | "medium" | "high" }) {
  const variant: Variant = severity === "error" || severity === "high" ? "destructive" : severity === "warning" || severity === "medium" ? "warning" : "info";
  return <Badge variant={variant}>{enumLabel(severity)}</Badge>;
}

export function GenericStatusBadge({ status }: { status: string }) {
  const tone: Variant = /SUCCEEDED|READY|SENT|ACTIVE|LOGGED/.test(status) ? "success" : /FAILED|DEAD|ERROR/.test(status) ? "destructive" : /RUNNING|QUEUED|PENDING|RENDERING/.test(status) ? "info" : "muted";
  return <Badge variant={tone}>{enumLabel(status)}</Badge>;
}
