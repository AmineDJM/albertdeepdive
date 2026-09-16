"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Checkbox } from "@/components/ui/checkbox";
import { createEditionAction } from "./actions";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function NewEditionDialog({ nextIssueNumber, defaultMonth, defaultYear }: { nextIssueNumber: number; defaultMonth: number; defaultYear: number }) {
  const params = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(params.get("new") === "1");
  const [pending, startTransition] = useTransition();
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);
  const [issueNumber, setIssueNumber] = useState(nextIssueNumber);
  const [special, setSpecial] = useState(false);
  const [pages, setPages] = useState(24);
  const [publication, setPublication] = useState(`${defaultYear}-${String(defaultMonth).padStart(2, "0")}-15`);
  const [finalReview, setFinalReview] = useState(`${defaultYear}-${String(defaultMonth).padStart(2, "0")}-11`);

  function submit() {
    startTransition(async () => {
      const res = await createEditionAction({ month, year, issueNumber, isSpecialIssue: special, targetPageCount: pages, publicationTargetAt: new Date(`${publication}T10:00:00`), finalReviewAt: new Date(`${finalReview}T18:00:00`) });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Edition created", { description: "Default sections were added. Schedule the campaign next." });
      setOpen(false);
      router.push(`/editions/${res.data.id}/campaign`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New edition
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create an edition</DialogTitle>
          <DialogDescription>Each edition gets the default sections and its own campaign schedule. Dates can be changed later.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Month</Label>
            <NativeSelect value={month} onChange={(e) => { const m = Number(e.target.value); setMonth(m); setPublication(`${year}-${String(m).padStart(2, "0")}-15`); setFinalReview(`${year}-${String(m).padStart(2, "0")}-11`); }}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <Input type="number" value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); setPublication(`${y}-${String(month).padStart(2, "0")}-15`); setFinalReview(`${y}-${String(month).padStart(2, "0")}-11`); }} min={2024} max={2100} />
          </div>
          <div className="space-y-1.5">
            <Label>Issue number</Label>
            <Input type="number" value={issueNumber} onChange={(e) => setIssueNumber(Number(e.target.value))} min={1} />
          </div>
          <div className="space-y-1.5">
            <Label>Target pages</Label>
            <Input type="number" value={pages} onChange={(e) => setPages(Number(e.target.value))} min={4} max={96} step={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Final review</Label>
            <Input type="date" value={finalReview} onChange={(e) => setFinalReview(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Publication target</Label>
            <Input type="date" value={publication} onChange={(e) => setPublication(e.target.value)} />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-[13px]">
            <Checkbox checked={special} onCheckedChange={(v) => setSpecial(v === true)} /> Special issue (hors-série)
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            Create edition
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
