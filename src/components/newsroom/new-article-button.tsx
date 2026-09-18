"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createArticleAction } from "@/app/(newsroom)/editions/[editionId]/articles/actions";
import { STORY_TYPES } from "@/lib/constants";
import { useUi } from "@/components/i18n/provider";

/**
 * Creates an article from scratch — a story and an empty article that did not come from a
 * submission — then opens it in the workbench to write by hand.
 */
export function NewArticleButton({ editionId, sections }: { editionId: string; sections: { id: string; name: string }[] }) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [storyType, setStoryType] = useState("OTHER");
  const [saving, startSave] = useTransition();

  function submit() {
    if (!title.trim()) {
      toast.error(tr("Give the article a working title"));
      return;
    }
    startSave(async () => {
      const res = await createArticleAction(editionId, { title: title.trim(), sectionId: sectionId || null, storyType });
      if (res.ok) {
        toast.success(res.message ?? "Article created");
        setOpen(false);
        router.push(`/articles/${res.data.articleId}`);
      } else {
        toast.error(res.error);
      }
    });
  }

  function onOpenChange(v: boolean) {
    setOpen(v);
    if (v) {
      setTitle("");
      setSectionId("");
      setStoryType("OTHER");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus />{" "}{tr("New article")}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("New article from scratch")}</DialogTitle>
          <DialogDescription>{tr("Creates a blank article you write by hand — for something that did not come through the contribution form. You can place it on the flat-plan like any other.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="na-title">{tr("Working title")}</Label>
            <Input id="na-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tr("e.g. Editorial — a year of firsts")} autoFocus onKeyDown={(e) => e.key === "Enter" && submit()} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="na-section">{tr("Section")}</Label>
              <NativeSelect id="na-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                <option value="">{tr("Auto / none")}</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="na-type">{tr("Type")}</Label>
              <NativeSelect id="na-type" value={storyType} onChange={(e) => setStoryType(e.target.value)}>
                {STORY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tr("Cancel")}</Button>
          <Button onClick={submit} loading={saving} disabled={!title.trim()}>
            <Plus />{" "}{tr("Create & write")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
