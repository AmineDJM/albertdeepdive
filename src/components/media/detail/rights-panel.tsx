"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RightsBadge } from "@/components/newsroom/status-badge";
import { cn, formatDateTime } from "@/lib/utils";
import { RIGHTS_STATUS_LABELS } from "@/lib/constants";
import type { MediaConsentView } from "@/server/media/library";
import { RIGHTS_DOT_CLASS, RIGHTS_STATUSES, type RightsStatus } from "@/server/media/constants";
import { recordConsentAction, setRightsAction } from "@/app/(newsroom)/media/[mediaId]/actions";
import { useUi } from "@/components/i18n/provider";

const HINTS: Record<RightsStatus, string> = {
  GREEN: "Cleared for print and digital.",
  YELLOW: "Usable in drafts; must be cleared before publication.",
  RED: "Blocked: never exported, cannot be attached to a story.",
};

const CONSENT_LABELS = {
  PUBLICATION: "Publication",
  IMAGE_RIGHTS: "Image rights",
  DATA_PROCESSING: "Data processing",
} as const;

export function RightsPanel({
  assetId,
  editionId,
  status,
  note,
  consents,
  canRights,
  contributorName,
}: {
  assetId: string;
  editionId: string | null;
  status: RightsStatus;
  note: string | null;
  consents: MediaConsentView[];
  canRights: boolean;
  contributorName: string | null;
}) {
  const tr = useUi();
  const router = useRouter();
  const [draftStatus, setDraftStatus] = useState<RightsStatus | null>(null);
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [pending, startTransition] = useTransition();
  const noteChanged = draftNote.trim() !== (note ?? "").trim();

  function commit(next: RightsStatus) {
    startTransition(async () => {
      const res = await setRightsAction(assetId, editionId, next, draftNote);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setDraftStatus(null);
      router.refresh();
    });
  }

  function logConsent() {
    startTransition(async () => {
      const res = await recordConsentAction(assetId, editionId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  return (
    <div className="border-border bg-card rounded-lg border shadow-xs">
      <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <div className="label-caps">{tr("Rights")}</div>
          <div className="mt-1 flex items-center gap-2">
            <RightsBadge status={status} />
            <span className="text-muted-foreground text-xs">{HINTS[status]}</span>
          </div>
        </div>
        <ShieldCheck
          className={cn(
            "size-4 shrink-0",
            status === "GREEN"
              ? "text-success"
              : status === "YELLOW"
                ? "text-warning"
                : "text-destructive",
          )}
        />
      </div>
      <div className="space-y-3 px-4 py-3">
        {canRights ? (
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={tr("Set rights status")}>
            {RIGHTS_STATUSES.map((st) => {
              const active = (draftStatus ?? status) === st;
              return (
                <Button
                  key={st}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "outline"}
                  aria-pressed={active}
                  onClick={() => setDraftStatus(st === status ? null : st)}
                  className="justify-center"
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      RIGHTS_DOT_CLASS[st],
                      active && "ring-2 ring-white/60",
                    )}
                  />
                  {RIGHTS_STATUS_LABELS[st]}
                </Button>
              );
            })}
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="rights-note">{tr("Rights note")}</Label>
          {canRights ? (
            <Textarea
              id="rights-note"
              rows={2}
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder={tr("Who confirmed what, and when (e.g. “contributor confirmed by email, 12 May”)")}
              className="min-h-0"
            />
          ) : (
            <p className="text-[13px]">
              {note || <span className="text-muted-foreground">—</span>}
            </p>
          )}
        </div>
        {canRights && draftStatus && draftStatus !== status ? (
          <div className="border-brand/40 bg-brand-soft/40 flex items-center justify-between gap-2 rounded-md border px-3 py-2">
            <span className="text-xs">
              {tr("Set to")}{" "}<strong>{RIGHTS_STATUS_LABELS[draftStatus]}</strong>
              {draftStatus === "RED" ? " — the asset will be blocked at export." : ""}
            </span>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDraftStatus(null)}
                disabled={pending}
              >
                {tr("Cancel")}</Button>
              <Button
                size="sm"
                variant={draftStatus === "RED" ? "destructive" : "default"}
                loading={pending}
                onClick={() => commit(draftStatus)}
              >
                {tr("Confirm")}</Button>
            </div>
          </div>
        ) : canRights && noteChanged ? (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" loading={pending} onClick={() => commit(status)}>
              {tr("Save note")}</Button>
          </div>
        ) : null}
      </div>
      <div className="border-t px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="label-caps">{tr("Consent records")}</div>
          {canRights ? (
            <Button
              size="xs"
              variant="outline"
              onClick={logConsent}
              loading={pending}
              title={
                contributorName
                  ? `Record that ${contributorName} confirmed the image rights`
                  : "Record an image-rights confirmation for this asset"
              }
            >
              <FileCheck2 /> {" "}{tr("Log confirmation")}</Button>
          ) : null}
        </div>
        {consents.length ? (
          <ul className="mt-2 space-y-2">
            {consents.map((c) => (
              <li
                key={c.id}
                className="border-border bg-muted/30 rounded-md border px-2.5 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{CONSENT_LABELS[c.type]}</span>
                  {c.revokedAt ? (
                    <Badge variant="destructive">{tr("Revoked")}</Badge>
                  ) : c.accepted ? (
                    <Badge variant="success">{tr("Accepted")}</Badge>
                  ) : (
                    <Badge variant="destructive">{tr("Declined")}</Badge>
                  )}
                  <Badge variant="muted">v{c.textVersion}</Badge>
                  <Badge variant="outline">
                    {c.scope === "asset" ? "this asset" : "with the submission"}
                  </Badge>
                </div>
                <div className="text-muted-foreground mt-1">
                  {c.contributorName ?? "Unknown contributor"} · {formatDateTime(c.acceptedAt)}
                  {c.revokedAt ? ` · revoked ${formatDateTime(c.revokedAt)}` : ""}
                </div>
                {c.text ? (
                  <p className="text-2xs text-muted-foreground mt-1 italic">“{c.text}”</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground mt-1.5 text-xs">
            {tr("No consent recorded for this image yet")}{" "}{contributorName ? ` — ask ${contributorName} or log a confirmation` : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
