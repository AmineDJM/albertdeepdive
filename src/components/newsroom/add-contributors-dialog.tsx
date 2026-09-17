"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { addContributorsToEditionAction, searchCandidatesAction, type CandidateContributor } from "@/app/(newsroom)/editions/[editionId]/campaign/actions";
import { enumLabel } from "@/lib/utils";

/**
 * Adds specific people from the pool to this edition's campaign, by hand — beyond the random
 * selection. The list shows only contributors not already invited; if the campaign is open they
 * are emailed their personal link as soon as they are added.
 */
export function AddContributorsDialog({ editionId, campuses, campaignOpen }: { editionId: string; campuses: { id: string; name: string }[]; campaignOpen: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const [q, setQ] = useState("");
  const [campusId, setCampusId] = useState("");
  const [candidates, setCandidates] = useState<CandidateContributor[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function load(nextQ: string, nextCampus: string) {
    startLoad(async () => {
      const res = await searchCandidatesAction(editionId, { q: nextQ.trim() || undefined, campusId: nextCampus || undefined });
      if (res.ok) setCandidates(res.data);
      else toast.error(res.error);
    });
  }

  function onOpenChange(v: boolean) {
    setOpen(v);
    if (v) {
      setSelected(new Set());
      setQ("");
      setCampusId("");
      load("", "");
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    startSave(async () => {
      const res = await addContributorsToEditionAction(editionId, [...selected]);
      if (res.ok) {
        toast.success(res.message ?? "Added");
        setOpen(false);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline">
          <UserPlus /> Add contributors
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add contributors to this edition</DialogTitle>
          <DialogDescription>
            Pick people from the pool to invite on top of the automatic selection.
            {campaignOpen ? " The campaign is open, so they receive their personal link straight away." : " They will be invited when the campaign opens."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => { setQ(e.target.value); load(e.target.value, campusId); }} placeholder="Search name or email…" className="h-8 pl-8 text-xs" />
          </div>
          <NativeSelect aria-label="Campus" className="h-8 w-40 text-xs" value={campusId} onChange={(e) => { setCampusId(e.target.value); load(q, e.target.value); }}>
            <option value="">All campuses</option>
            <option value="school">School-wide</option>
            {campuses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>

        <div className="max-h-[46vh] min-h-40 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" /> Searching…
            </div>
          ) : candidates.length ? (
            <ul className="divide-y divide-border">
              {candidates.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent/40">
                    <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggle(c.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">
                        {c.firstName} {c.lastName}
                      </span>
                      <span className="block truncate text-2xs text-muted-foreground">{c.email}</span>
                    </span>
                    <span className="shrink-0 text-2xs text-muted-foreground">{c.campusName ?? "School-wide"}</span>
                    <Badge variant="outline" className="shrink-0 text-2xs">
                      {enumLabel(c.type)}
                    </Badge>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-1 text-center text-xs text-muted-foreground">
              <p>No one left to add.</p>
              <p className="text-2xs">Everyone matching is already invited. Add someone new on the Contributors screen first.</p>
            </div>
          )}
        </div>

        <DialogFooter className="items-center">
          <span className="mr-auto text-2xs text-muted-foreground">{selected.size} selected</span>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving} disabled={!selected.size}>
            <UserPlus /> Add {selected.size || ""} {selected.size === 1 ? "contributor" : "contributors"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
