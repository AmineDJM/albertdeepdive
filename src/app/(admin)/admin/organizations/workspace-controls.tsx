"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, LogIn, MoreHorizontal, RotateCcw, SlidersHorizontal } from "lucide-react";
import { clearOverridesAction, enterWorkspaceAction, setOverridesAction } from "../actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { OverrideRow } from "@/server/platform/overrides";
import { ROLE_LABELS, type Role } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

const SIMULATE: Role[] = ["EDITOR_IN_CHIEF", "EDITOR", "CAMPUS_EDITOR", "VIEWER"];

/**
 * What a platform admin can do to one workspace.
 *
 * Two jobs. Enter it — with full rights to fix something, or wearing a customer role to see what
 * they see. And give it something its plan does not include, which every SaaS ends up needing and
 * which is much better as a recorded patch than as a plan invented for one customer.
 */
export function WorkspaceControls({
  workspace,
  overrides,
}: {
  workspace: { id: string; name: string; planName: string | null };
  overrides: { planName: string; rows: OverrideRow[] };
}) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const active = overrides.rows.filter((row) => row.overridden).length;

  const value = (row: OverrideRow) => (row.key in draft ? draft[row.key] : row.effective);

  function save() {
    startTransition(async () => {
      const result = await setOverridesAction(workspace.id, draft);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${workspace.name} updated`);
      setDraft({});
      setOpen(false);
      router.refresh();
    });
  }

  function reset() {
    startTransition(async () => {
      const result = await clearOverridesAction(workspace.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${workspace.name} is back on exactly what ${overrides.planName} gives`);
      setDraft({});
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Manage ${workspace.name}`} disabled={pending}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuItem onSelect={() => startTransition(async () => void (await enterWorkspaceAction(workspace.id)))}>
            <LogIn />{" "}{tr("Open with full rights")}</DropdownMenuItem>
          <DropdownMenuLabel>{tr("Open as…")}</DropdownMenuLabel>
          {SIMULATE.map((role) => (
            <DropdownMenuItem key={role} onSelect={() => startTransition(async () => void (await enterWorkspaceAction(workspace.id, { role })))}>
              <Eye /> {ROLE_LABELS[role]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            <SlidersHorizontal />{" "}{tr("Rights and limits")}{active ? ` (${active})` : ""}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{workspace.name}</DialogTitle>
            <DialogDescription>
              {tr("On")}{" "}{overrides.planName}{tr(". Anything you change here applies to this workspace only and survives a change of plan — so it is shown next to what the plan itself gives.")}</DialogDescription>
          </DialogHeader>

          <div className="max-h-[52vh] space-y-4 overflow-y-auto pr-1 scrollbar-thin">
            <section className="space-y-3">
              <h3 className="label-caps">{tr("Limits")}</h3>
              {overrides.rows
                .filter((row) => row.kind === "limit")
                .map((row) => (
                  <div key={row.key} className="grid grid-cols-[1fr_120px] items-center gap-3">
                    <Label htmlFor={`ov-${row.key}`} className="flex flex-col items-start gap-0.5">
                      <span className="flex items-center gap-1.5">
                        {row.label}
                        {row.overridden || row.key in draft ? <Badge variant="muted">{tr("custom")}</Badge> : null}
                      </span>
                      <span className="text-2xs font-normal text-muted-foreground">
                        {overrides.planName}{" "}{tr("gives")}{" "}{row.planValue === null ? "unlimited" : String(row.planValue)}
                      </span>
                    </Label>
                    <Input
                      id={`ov-${row.key}`}
                      inputMode="numeric"
                      placeholder={tr("unlimited")}
                      value={value(row) === null ? "" : String(value(row) ?? "")}
                      disabled={pending}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        setDraft((current) => ({ ...current, [row.key]: raw === "" ? null : Number(raw.replace(/\D/g, "")) }));
                      }}
                      className="tabular text-right"
                    />
                  </div>
                ))}
              <p className="text-2xs text-muted-foreground">{tr("Blank means unlimited. Zero means none — they are not the same thing.")}</p>
            </section>

            <section className="space-y-2">
              <h3 className="label-caps">{tr("Features")}</h3>
              {overrides.rows
                .filter((row) => row.kind === "flag")
                .map((row) => (
                  <div key={row.key} className="flex items-center justify-between gap-3 py-0.5">
                    <Label htmlFor={`ov-${row.key}`} className="flex flex-col items-start gap-0.5">
                      <span className="flex items-center gap-1.5">
                        {row.label}
                        {row.overridden || row.key in draft ? <Badge variant="muted">{tr("custom")}</Badge> : null}
                      </span>
                      <span className={cn("text-2xs font-normal text-muted-foreground")}>{row.planValue ? "included in the plan" : "not in the plan"}</span>
                    </Label>
                    <Switch id={`ov-${row.key}`} checked={Boolean(value(row))} disabled={pending} onCheckedChange={(checked) => setDraft((current) => ({ ...current, [row.key]: checked }))} />
                  </div>
                ))}
            </section>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" size="sm" onClick={reset} disabled={pending || !active}>
              <RotateCcw />{" "}{tr("Back to the plan")}</Button>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
                {tr("Cancel")}</Button>
              <Button size="sm" onClick={save} loading={pending} disabled={!Object.keys(draft).length}>
                {tr("Save")}</Button>
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
