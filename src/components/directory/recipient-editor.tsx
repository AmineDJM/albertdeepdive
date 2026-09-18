"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { createRecipientAction, updateRecipientAction } from "@/app/(newsroom)/directory/actions";
import { enumLabel } from "@/lib/utils";
import { AUDIENCE_SEGMENTS } from "@/lib/constants";
import { useUi } from "@/components/i18n/provider";

export type RecipientEditorValue = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  segment: (typeof AUDIENCE_SEGMENTS)[number];
  organisation: string | null;
  campusId: string | null;
  isActive: boolean;
  tags: string[];
  notes: string | null;
};

const EMPTY: RecipientEditorValue = { firstName: "", lastName: "", email: "", segment: "STUDENT", organisation: null, campusId: null, isActive: true, tags: [], notes: null };

export function RecipientEditor({ value, campuses, openOnParam = false }: { value?: RecipientEditorValue; campuses: { id: string; name: string }[]; openOnParam?: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(openOnParam && params.get("new") === "1");
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<RecipientEditorValue>(value ?? EMPTY);
  const set = <K extends keyof RecipientEditorValue>(k: K, v: RecipientEditorValue[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    startTransition(async () => {
      const payload = { ...form, id: undefined };
      const res = value?.id ? await updateRecipientAction(value.id, payload) : await createRecipientAction(payload);
      if (!res.ok) {
        toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
        return;
      }
      toast.success(res.message);
      setOpen(false);
      if (!value) setForm(EMPTY);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {value ? (
          <Button size="sm" variant="outline"><Pencil />{" "}{tr("Edit")}</Button>
        ) : (
          <Button><Plus />{" "}{tr("Add recipient")}</Button>
        )}
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{value ? `Edit ${value.firstName} ${value.lastName}`.trim() : "Add a recipient"}</DialogTitle>
          <DialogDescription>{tr("Recipients receive the finished magazine. This directory is separate from the contributor pool.")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>{tr("First name")}</Label><Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{tr("Last name")}</Label><Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label>{tr("Email")}</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>{tr("Segment")}</Label>
            <NativeSelect value={form.segment} onChange={(e) => set("segment", e.target.value as RecipientEditorValue["segment"])}>
              {AUDIENCE_SEGMENTS.map((seg) => <option key={seg} value={seg}>{tr(enumLabel(seg))}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label>{tr("Campus")}</Label>
            <NativeSelect value={form.campusId ?? ""} onChange={(e) => set("campusId", e.target.value || null)}>
              <option value="">{tr("School-wide")}</option>
              {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </div>
          <div className="col-span-2 space-y-1.5"><Label>{tr("Organisation")}</Label><Input value={form.organisation ?? ""} onChange={(e) => set("organisation", e.target.value || null)} placeholder={tr("e.g. partner company, association")} /></div>
          <div className="col-span-2 space-y-1.5"><Label>{tr("Tags")}</Label><Input value={form.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} placeholder={tr("vip, print, newsletter")} /></div>
          <div className="col-span-2 space-y-1.5"><Label>{tr("Notes")}</Label><Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} rows={2} /></div>
          <label className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2 text-[13px]"><span>{tr("Active — receives the magazine")}</span><Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tr("Cancel")}</Button>
          <Button onClick={submit} loading={pending} disabled={!form.firstName || !form.email}>{value ? "Save changes" : "Add recipient"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
