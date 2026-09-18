"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCollectionAction } from "./actions";
import { useUi } from "@/components/i18n/provider";

/** A collection starts as a name. Everything else is decided on its own page, with its items. */
export function NewCollection() {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await createCollectionAction({ title, tagline: tagline || null });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setOpen(false);
      setTitle("");
      setTagline("");
      router.push(`/admin/collections/${res.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> {tr("New collection")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("New collection")}</DialogTitle>
          <DialogDescription>{tr("It starts as a draft: nothing is public until you publish it, and nothing appears in it without its owner’s consent.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="collection-title">{tr("Name")}</Label>
            <Input id="collection-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr("Universities")} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="collection-tagline">{tr("One line under it")}</Label>
            <Input id="collection-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={tr("How campuses tell their own story.")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{tr("Cancel")}</Button>
          <Button onClick={submit} loading={pending} disabled={title.trim().length < 2}>{tr("Create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
