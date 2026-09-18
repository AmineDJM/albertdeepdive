"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createCampusAction, updateCampusAction } from "./actions";
import { useUi } from "@/components/i18n/provider";

type Campus = { id: string; name: string; city: string | null; country: string | null; colour: string | null; timezone: string | null; isActive: boolean; defaultInviteTarget?: number };

export function CampusEditor({ campus, trigger }: { campus?: Campus; trigger?: React.ReactNode }) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(campus?.name ?? "");
  const [city, setCity] = useState(campus?.city ?? "");
  const [country, setCountry] = useState(campus?.country ?? "France");
  const [colour, setColour] = useState(campus?.colour ?? "#2BAFE0");
  const [timezone, setTimezone] = useState(campus?.timezone ?? "Europe/Paris");
  const [isActive, setIsActive] = useState(campus?.isActive ?? true);
  const [defaultInviteTarget, setDefaultInviteTarget] = useState(String(campus?.defaultInviteTarget ?? 0));

  function submit() {
    startTransition(async () => {
      const payload = { name, city: city || null, country: country || null, colour, timezone, isActive, defaultInviteTarget: Math.max(0, Math.floor(Number(defaultInviteTarget) || 0)) };
      const res = campus ? await updateCampusAction(campus.id, payload) : await createCampusAction(payload);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size={campus ? "icon-sm" : "default"} variant={campus ? "ghost" : "default"} aria-label={campus ? "Edit campus" : "Add campus"}>
            {campus ? <Pencil /> : <><Plus />{" "}{tr("Add campus")}</>}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{campus ? `Edit ${campus.name}` : "Add a campus"}</DialogTitle>
          <DialogDescription>{tr("Campuses drive coverage tracking, contributor targets and section balance.")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1.5">
            <Label>{tr("Name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Geneva")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{tr("City")}</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("Country")}</Label>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{tr("Colour")}</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={colour} onChange={(e) => setColour(e.target.value)} className="size-8 cursor-pointer rounded border border-input bg-card p-0.5" aria-label={tr("Campus colour")} />
                <Input value={colour} onChange={(e) => setColour(e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{tr("Timezone")}</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campus-target">{tr("People invited per campaign")}</Label>
              <Input id="campus-target" type="number" min={0} value={defaultInviteTarget} onChange={(e) => setDefaultInviteTarget(e.target.value)} />
              <p className="text-2xs text-muted-foreground">{tr("The default number chosen at random each month. Editors can still adjust it per campaign.")}</p>
            </div>
          </div>
          <label className="flex items-center justify-between rounded-md border px-3 py-2 text-[13px]">
            <span>{tr("Active campus")}</span>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tr("Cancel")}</Button>
          <Button onClick={submit} loading={pending} disabled={name.trim().length < 2}>{campus ? "Save" : "Add campus"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
