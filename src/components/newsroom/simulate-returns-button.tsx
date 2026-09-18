"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { simulateReturnsAction } from "@/app/(newsroom)/editions/[editionId]/actions";
import { useUi } from "@/components/i18n/provider";

/**
 * Super-admin power tool. Fills the edition with realistic fake form submissions so the whole issue
 * — clustering, articles, layout, PDF — can be demoed without waiting for real contributors.
 */
export function SimulateReturnsButton({ editionId }: { editionId: string }) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(12);
  const [photos, setPhotos] = useState(true);
  const [saving, startSave] = useTransition();

  function submit() {
    startSave(async () => {
      const res = await simulateReturnsAction(editionId, { count, attachPhotos: photos });
      if (res.ok) {
        toast.success(res.message ?? "Fake submissions added");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" title={tr("Fill this edition with fake form submissions (super-admin demo tool)")}>
          <FlaskConical /> {" "}{tr("Simulate returns")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("Simulate contribution returns")}</DialogTitle>
          <DialogDescription>
            {tr("Adds realistic fake submissions to this edition — as if students had filled the form — so you can run the pipeline and see the issue render. A demo tool; it never emails anyone.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="sim-count">{tr("How many")}</Label>
              <p className="text-2xs text-muted-foreground">{tr("Between 1 and 60.")}</p>
            </div>
            <Input
              id="sim-count"
              type="number"
              min={1}
              max={60}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              className="h-9 w-24 text-right"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="sim-photos">{tr("Attach photos")}</Label>
              <p className="text-2xs text-muted-foreground">{tr("Borrows seed images so the media and rights gates have something to check.")}</p>
            </div>
            <Switch id="sim-photos" checked={photos} onCheckedChange={setPhotos} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tr("Cancel")}</Button>
          <Button onClick={submit} loading={saving}>
            <FlaskConical /> {" "}{tr("Add")}{" "}{count} {" "}{tr("submission")}{count === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
