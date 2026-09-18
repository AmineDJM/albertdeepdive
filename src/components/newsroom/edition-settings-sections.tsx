"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SortableSections, type SectionCounts, type SectionItem } from "@/components/settings/sortable-sections";
import { saveEditionSectionsAction, type EditionSectionPatch } from "@/app/(newsroom)/editions/[editionId]/settings/actions";
import { useUi } from "@/components/i18n/provider";

export type EditionSectionInput = {
  id: string;
  slug: string;
  name: string;
  kicker: string | null;
  colour: string | null;
  isHidden: boolean;
  targetPages: number | null;
  stories: number;
  candidates: number;
};

function toItems(sections: EditionSectionInput[]): SectionItem[] {
  return sections.map((s) => ({
    uid: s.id,
    id: s.id,
    slug: s.slug,
    name: s.name,
    kicker: s.kicker ?? "",
    colour: s.colour ?? "#10203A",
    targetPages: s.targetPages,
    isHidden: s.isHidden,
    slugTouched: true,
  }));
}

/** Section list of THIS edition: reorder, rename, hide and set a page target per section. */
export function EditionSettingsSections({
  editionId,
  sections,
  targetPageCount,
  canManage,
}: {
  editionId: string;
  sections: EditionSectionInput[];
  targetPageCount: number;
  canManage: boolean;
}) {
  const tr = useUi();
  const router = useRouter();
  const [items, setItems] = useState<SectionItem[]>(() => toItems(sections));
  const [pending, start] = useTransition();

  const counts: SectionCounts = useMemo(
    () => Object.fromEntries(sections.map((s) => [s.id, { stories: s.stories, candidates: s.candidates }])),
    [sections],
  );
  const initial = useMemo(() => JSON.stringify(toItems(sections)), [sections]);
  const dirty = JSON.stringify(items) !== initial;

  const problems = useMemo(() => {
    const out: string[] = [];
    const slugs = new Set<string>();
    for (const it of items) {
      if (!it.name.trim()) out.push("Every section needs a name");
      if (!it.slug.trim()) out.push("Every section needs a slug");
      if (slugs.has(it.slug)) out.push(`Duplicate slug “${it.slug}”`);
      slugs.add(it.slug);
    }
    if (!items.length) out.push("Keep at least one section");
    return [...new Set(out)];
  }, [items]);

  const plannedPages = items.filter((i) => !i.isHidden).reduce((n, i) => n + (i.targetPages ?? 0), 0);

  function save() {
    start(async () => {
      const payload: EditionSectionPatch[] = items.map((it) => ({
        id: it.id,
        slug: it.slug,
        name: it.name.trim(),
        kicker: it.kicker.trim() || null,
        colour: it.colour || null,
        isHidden: it.isHidden,
        targetPages: it.targetPages,
      }));
      const res = await saveEditionSectionsAction(editionId, payload);
      if (!res.ok) {
        toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <SortableSections items={items} onChange={setItems} counts={counts} dndId={`edition-sections-${editionId}`} readOnly={!canManage} />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
        <div className="text-xs text-muted-foreground">
          {items.filter((i) => !i.isHidden).length}{" "}{tr("visible of")}{" "}{items.length}{" "}{tr("sections ·")}{" "}{plannedPages}{" "}{tr("of")}{" "}{targetPageCount}{" "}{tr("target pages allocated")}{" "}{plannedPages > targetPageCount ? <span className="ml-2 text-warning">{plannedPages - targetPageCount}{" "}{tr("pages over the target")}</span> : null}
          {problems.length ? <span className="ml-2 text-destructive">{problems[0]}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          {dirty && canManage ? (
            <Button variant="ghost" size="sm" onClick={() => setItems(toItems(sections))} disabled={pending}>
              {tr("Discard")}</Button>
          ) : null}
          <Button size="sm" onClick={save} loading={pending} disabled={!canManage || !dirty || problems.length > 0}>
            <Save />{" "}{tr("Save sections")}</Button>
        </div>
      </div>
    </div>
  );
}
