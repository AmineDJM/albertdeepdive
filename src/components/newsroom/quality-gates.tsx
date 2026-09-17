"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Check, Clock, ShieldAlert, ShieldCheck, Undo2, Wrench, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clearOverrideAction, fixGateAction, overrideGateAction } from "@/app/(newsroom)/editions/[editionId]/qa/actions";
import type { QualityGate } from "@/server/publication/validate";
import { cn } from "@/lib/utils";

/** Gates the checklist can fix in place (the rest — RED media, factual conflicts — need a human). */
const FIXABLE = new Set(["every_selected_article_approved", "image_rights_validated", "cover_approved", "page_layout_validated", "toc_consistent", "page_numbers_consistent", "no_text_overflow", "pdf_generated", "docx_generated"]);

const ICONS = { pass: Check, fail: X, warn: AlertTriangle, pending: Clock } as const;
const TONES = {
  pass: "text-success border-success/30 bg-success-soft/40",
  fail: "text-destructive border-destructive/30 bg-destructive-soft/40",
  warn: "text-warning border-warning/30 bg-warning-soft/40",
  pending: "text-muted-foreground border-border bg-muted/30",
} as const;

/**
 * The publication checklist. A failing blocking gate stops the issue; only the editor in chief can
 * override one, and only with a written reason, which then replaces the gate's own explanation.
 */
export function QualityGates({ editionId, gates, canOverride }: { editionId: string; gates: QualityGate[]; canOverride: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<QualityGate | null>(null);
  const [reason, setReason] = useState("");

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(res.message ?? "Done");
        after?.();
        router.refresh();
      } else toast.error(res.error ?? "Failed");
    });
  }

  return (
    <>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {gates.map((gate) => {
          const Icon = ICONS[gate.status];
          return (
            <li key={gate.key} className="flex items-start gap-3 bg-card px-3.5 py-3">
              <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border", TONES[gate.status])}>
                <Icon className="size-3" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-medium">{gate.label}</span>
                  {gate.blocking ? <Badge variant="outline" className="text-2xs">Blocking</Badge> : <Badge variant="muted" className="text-2xs">Advisory</Badge>}
                  {gate.overridden ? <Badge variant="warning" className="text-2xs">Overridden</Badge> : null}
                </div>
                <p className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{gate.details}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {canOverride && FIXABLE.has(gate.key) && (gate.status === "fail" || gate.status === "warn" || gate.status === "pending") ? (
                  <Button size="xs" variant="secondary" disabled={pending} onClick={() => run(() => fixGateAction(editionId, gate.key))} title="Fix this automatically">
                    <Wrench /> Fix
                  </Button>
                ) : null}
                {gate.href ? (
                  <Button size="icon-sm" variant="ghost" asChild title="Go and fix this by hand" aria-label="Go and fix this by hand">
                    <Link href={gate.href}>
                      <ArrowUpRight />
                    </Link>
                  </Button>
                ) : null}
                {canOverride && gate.overridden ? (
                  <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => clearOverrideAction(editionId, gate.key))}>
                    <Undo2 /> Lift
                  </Button>
                ) : canOverride && gate.overridable && (gate.status === "fail" || gate.status === "warn") ? (
                  <Button size="xs" variant="outline" disabled={pending} onClick={() => { setTarget(gate); setReason(""); }}>
                    <ShieldAlert /> Override
                  </Button>
                ) : !gate.overridable && gate.status === "fail" ? (
                  <span className="flex items-center gap-1 pr-1 text-2xs text-muted-foreground">
                    <ShieldCheck className="size-3" /> Cannot be overridden
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Override “{target?.label}”</DialogTitle>
            <DialogDescription>
              This gate is failing. Overriding it lets the issue go to print anyway. The reason you give is recorded against the edition and shown on the gate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="override-reason">Why is it safe to publish without this?</Label>
            <Textarea id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="The photographer confirmed the rights by email on 3 May; the written licence follows." />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={pending}
              disabled={!reason.trim()}
              onClick={() => target && run(() => overrideGateAction(editionId, target.key, reason), () => setTarget(null))}
            >
              <ShieldAlert /> Override the gate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
