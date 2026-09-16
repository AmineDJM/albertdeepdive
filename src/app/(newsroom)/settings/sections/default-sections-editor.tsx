"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import type { DefaultSectionInput } from "@/server/settings/schemas";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { SortableSections, type SectionItem } from "@/components/settings/sortable-sections";
import { resetDefaultSectionsAction, saveDefaultSectionsAction } from "./actions";

function toItems(sections: DefaultSectionInput[]): SectionItem[] {
  return sections.map((s, i) => ({ uid: `s-${i}-${s.slug}`, slug: s.slug, name: s.name, kicker: s.kicker ?? "", colour: s.colour ?? "#10203A", targetPages: s.targetPages ?? null, isHidden: s.isHidden ?? false, slugTouched: true }));
}

export function DefaultSectionsEditor({ sections }: { sections: DefaultSectionInput[] }) {
  const router = useRouter();
  const [items, setItems] = useState<SectionItem[]>(() => toItems(sections));
  const storyTypesByUid = useRef(new Map(toItems(sections).map((it, i) => [it.uid, sections[i].storyTypes ?? []])));
  const [pending, start] = useTransition();
  const initial = useMemo(() => JSON.stringify(toItems(sections)), [sections]);
  const dirty = JSON.stringify(items) !== initial;
  const problems = useMemo(() => {
    const out: string[] = [];
    const slugs = new Set<string>();
    for (const it of items) {
      if (!it.name.trim()) out.push("Every section needs a name");
      if (!it.slug.trim()) out.push("Every section needs a slug");
      if (slugs.has(it.slug)) out.push(`Duplicate slug "${it.slug}"`);
      slugs.add(it.slug);
    }
    if (!items.length) out.push("Keep at least one section");
    return [...new Set(out)];
  }, [items]);

  function save() {
    start(async () => {
      const payload: DefaultSectionInput[] = items.map((it) => ({ slug: it.slug, name: it.name.trim(), kicker: it.kicker.trim() || null, colour: it.colour, targetPages: it.targetPages, isHidden: it.isHidden, storyTypes: storyTypesByUid.current.get(it.uid) ?? [] }));
      const res = await saveDefaultSectionsAction(payload);
      if (!res.ok) {
        toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  const totalPages = items.filter((i) => !i.isHidden).reduce((n, i) => n + (i.targetPages ?? 0), 0);

  return (
    <div className="space-y-3">
      <SortableSections items={items} onChange={setItems} dndId="default-sections" />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <div className="text-xs text-muted-foreground">
          {items.length} sections · {totalPages} target pages
          {problems.length ? <span className="ml-2 text-destructive">{problems[0]}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={pending}>
                <RotateCcw /> Reset to defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset the section template?</AlertDialogTitle>
                <AlertDialogDescription>The twelve sections inferred from the reference issue are restored. Existing editions keep their own sections.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    start(async () => {
                      const res = await resetDefaultSectionsAction();
                      if (!res.ok) {
                        toast.error(res.error);
                        return;
                      }
                      toast.success(res.message);
                      router.refresh();
                    })
                  }
                >
                  Reset
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button size="sm" onClick={save} loading={pending} disabled={!dirty || problems.length > 0}>
            <Save /> Save template
          </Button>
        </div>
      </div>
    </div>
  );
}
