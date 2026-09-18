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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { createContributorAction, updateContributorAction } from "./actions";
import { enumLabel } from "@/lib/utils";
import { CONTRIBUTOR_TYPES } from "@/lib/constants";
import { useUi } from "@/components/i18n/provider";


export type ContributorEditorValue = {
  id?: string;
  firstName: string;
  lastName: string;
  email: string;
  campusId: string | null;
  programId: string | null;
  type: (typeof CONTRIBUTOR_TYPES)[number];
  organisationName: string | null;
  preferredLanguage: "en" | "fr";
  isActive: boolean;
  tags: string[];
  notes: string | null;
  groupIds: string[];
};

export function ContributorEditor({ value, campuses, programs, groups, openOnParam = false }: { value?: ContributorEditorValue; campuses: { id: string; name: string }[]; programs: { id: string; code: string; name: string }[]; groups: { id: string; name: string }[]; openOnParam?: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(openOnParam && params.get("new") === "1");
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<ContributorEditorValue>(value ?? { firstName: "", lastName: "", email: "", campusId: null, programId: null, type: "STUDENT", organisationName: null, preferredLanguage: "en", isActive: true, tags: [], notes: null, groupIds: [] });
  const set = <K extends keyof ContributorEditorValue>(k: K, v: ContributorEditorValue[K]) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    startTransition(async () => {
      const payload = { ...form, id: undefined };
      const res = value?.id ? await updateContributorAction(value.id, payload) : await createContributorAction(payload);
      if (!res.ok) {
        toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
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
        {value ? (
          <Button size="sm" variant="outline"><Pencil />{" "}{tr("Edit")}</Button>
        ) : (
          <Button><Plus />{" "}{tr("New contributor")}</Button>
        )}
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{value ? `Edit ${value.firstName} ${value.lastName}` : "Add a contributor"}</DialogTitle>
          <DialogDescription>{tr("Contributors receive personal contribution links each month. Groups define who gets invited.")}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>{tr("First name")}</Label><Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{tr("Last name")}</Label><Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></div>
          <div className="col-span-2 space-y-1.5"><Label>{tr("Email")}</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>{tr("Campus")}</Label>
            <NativeSelect value={form.campusId ?? ""} onChange={(e) => set("campusId", e.target.value || null)}>
              <option value="">{tr("School-wide")}</option>
              {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label>{tr("Programme")}</Label>
            <NativeSelect value={form.programId ?? ""} onChange={(e) => set("programId", e.target.value || null)}>
              <option value="">—</option>
              {programs.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label>{tr("Type")}</Label>
            <NativeSelect value={form.type} onChange={(e) => set("type", e.target.value as ContributorEditorValue["type"])}>
              {CONTRIBUTOR_TYPES.map((t) => <option key={t} value={t}>{tr(enumLabel(t))}</option>)}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label>{tr("Preferred language")}</Label>
            <NativeSelect value={form.preferredLanguage} onChange={(e) => set("preferredLanguage", e.target.value as "en" | "fr")}>
              <option value="en">{tr("English")}</option>
              <option value="fr">{tr("Français")}</option>
            </NativeSelect>
          </div>
          <div className="col-span-2 space-y-1.5"><Label>{tr("Organisation / association")}</Label><Input value={form.organisationName ?? ""} onChange={(e) => set("organisationName", e.target.value || null)} placeholder={tr("e.g. Albertine, KÆRN, Corporate Relations")} /></div>
          <div className="col-span-2 space-y-1.5">
            <Label>{tr("Groups")}</Label>
            <div className="grid grid-cols-2 gap-1.5 rounded-md border p-2 sm:grid-cols-3">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-xs">
                  <Checkbox checked={form.groupIds.includes(g.id)} onCheckedChange={(v) => set("groupIds", v === true ? [...form.groupIds, g.id] : form.groupIds.filter((x) => x !== g.id))} />
                  <span className="truncate">{g.name}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="col-span-2 space-y-1.5"><Label>{tr("Tags")}</Label><Input value={form.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} placeholder={tr("photographer, translator")} /></div>
          <div className="col-span-2 space-y-1.5"><Label>{tr("Notes")}</Label><Textarea value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value || null)} rows={2} /></div>
          <label className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2 text-[13px]"><span>{tr("Active — receives contribution requests")}</span><Switch checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{tr("Cancel")}</Button>
          <Button onClick={submit} loading={pending} disabled={!form.firstName || !form.lastName || !form.email}>{value ? "Save changes" : "Add contributor"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
