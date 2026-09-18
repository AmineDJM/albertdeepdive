"use client";

import { useCallback, useMemo } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { EyeOff, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, slugify } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

export type SectionItem = {
  /** Local key for drag & drop (stable while editing). */
  uid: string;
  id?: string;
  slug: string;
  name: string;
  kicker: string;
  colour: string;
  targetPages: number | null;
  isHidden: boolean;
  /** True once the slug has been edited by hand (stops auto-slugging from the name). */
  slugTouched?: boolean;
};

export type SectionCounts = Record<string, { stories: number; candidates: number }>;

export function newSectionItem(partial: Partial<SectionItem> = {}): SectionItem {
  return { uid: `new-${Math.random().toString(36).slice(2, 10)}`, slug: "", name: "", kicker: "", colour: "#10203A", targetPages: 1, isHidden: false, ...partial };
}

export function SortableSections({ items, onChange, counts, dndId = "sections", readOnly = false }: { items: SectionItem[]; onChange: (next: SectionItem[]) => void; counts?: SectionCounts; dndId?: string; readOnly?: boolean }) {
  const tr = useUi();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = useMemo(() => items.map((i) => i.uid), [items]);
  const slugCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items) map.set(item.slug, (map.get(item.slug) ?? 0) + 1);
    return map;
  }, [items]);

  const update = useCallback(
    (uid: string, patch: Partial<SectionItem>) => {
      onChange(items.map((item) => (item.uid === uid ? { ...item, ...patch } : item)));
    },
    [items, onChange],
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onChange(arrayMove(items, from, to));
  }

  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[28px_28px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_72px_64px_32px] items-center gap-2 px-2 md:grid">
        <span />
        <span />
        <span className="label-caps">{tr("Name")}</span>
        <span className="label-caps">{tr("Slug")}</span>
        <span className="label-caps">{tr("Kicker")}</span>
        <span className="label-caps">{tr("Pages")}</span>
        <span className="label-caps">{tr("Shown")}</span>
        <span />
      </div>
      <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">
            {items.map((item, index) => {
              const count = counts?.[item.slug] ?? (item.id ? counts?.[item.id] : undefined);
              const stories = (count?.stories ?? 0) + (count?.candidates ?? 0);
              const duplicate = (slugCounts.get(item.slug) ?? 0) > 1;
              return (
                <SortableRow
                  key={item.uid}
                  item={item}
                  index={index}
                  readOnly={readOnly}
                  duplicate={duplicate}
                  stories={count ? stories : null}
                  onUpdate={(patch) => update(item.uid, patch)}
                  onRemove={() => onChange(items.filter((i) => i.uid !== item.uid))}
                />
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      {!readOnly ? (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, newSectionItem()])}>
          <Plus /> {" "}{tr("Add section")}</Button>
      ) : null}
    </div>
  );
}

function SortableRow({ item, index, readOnly, duplicate, stories, onUpdate, onRemove }: { item: SectionItem; index: number; readOnly: boolean; duplicate: boolean; stories: number | null; onUpdate: (patch: Partial<SectionItem>) => void; onRemove: () => void }) {
  const tr = useUi();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.uid, disabled: readOnly });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const blocked = stories !== null && stories > 0;
  return (
    <li ref={setNodeRef} style={style} className={cn("grid grid-cols-[28px_28px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_72px_64px_32px] items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5", isDragging && "z-10 shadow-md ring-2 ring-brand/40", item.isHidden && "opacity-70")}>
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={cn("flex size-7 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing", readOnly && "cursor-default opacity-40")}
        aria-label={`Reorder ${item.name || "section"} (position ${index + 1})`}
        {...attributes}
        {...listeners}
        disabled={readOnly}
      >
        <GripVertical className="size-4" />
      </button>
      <input
        type="color"
        value={item.colour}
        onChange={(e) => onUpdate({ colour: e.target.value })}
        className="size-7 cursor-pointer rounded border border-input bg-card p-0.5"
        aria-label={`Colour of ${item.name || "section"}`}
        disabled={readOnly}
      />
      <div className="min-w-0">
        <Input
          value={item.name}
          onChange={(e) => onUpdate({ name: e.target.value, ...(item.slugTouched || item.id ? {} : { slug: slugify(e.target.value) }) })}
          placeholder={tr("Section name")}
          aria-label={tr("Section name")}
          className="h-7"
          disabled={readOnly}
        />
        {stories !== null ? (
          <div className="mt-0.5 flex items-center gap-1.5 text-2xs text-muted-foreground">
            {stories} {stories === 1 ? "story" : "stories"}
            {item.isHidden ? (
              <span className="inline-flex items-center gap-0.5">
                · <EyeOff className="size-3" /> {" "}{tr("hidden")}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="min-w-0">
        <Input
          value={item.slug}
          onChange={(e) => onUpdate({ slug: slugify(e.target.value.toLowerCase()).replace(/-+$/, "") || e.target.value.toLowerCase(), slugTouched: true })}
          placeholder={tr("slug")}
          aria-label={tr("Section slug")}
          aria-invalid={duplicate || !item.slug}
          className="h-7 font-mono text-xs"
          disabled={readOnly || Boolean(item.id)}
          title={item.id ? "Slugs of existing sections are stable" : undefined}
        />
        {duplicate ? <p className="mt-0.5 text-2xs text-destructive">{tr("Duplicate slug")}</p> : null}
      </div>
      <Input value={item.kicker} onChange={(e) => onUpdate({ kicker: e.target.value })} placeholder={tr("Kicker")} aria-label={tr("Kicker")} className="h-7" disabled={readOnly} />
      <Input
        type="number"
        min={0}
        max={40}
        value={item.targetPages ?? ""}
        onChange={(e) => onUpdate({ targetPages: e.target.value === "" ? null : Math.max(0, Math.min(40, Number(e.target.value))) })}
        aria-label={tr("Target pages")}
        className="tabular h-7"
        disabled={readOnly}
      />
      <div className="flex justify-center">
        <Switch checked={!item.isHidden} onCheckedChange={(v) => onUpdate({ isHidden: !v })} aria-label={item.isHidden ? "Show section" : "Hide section"} disabled={readOnly} />
      </div>
      {readOnly ? (
        <span />
      ) : blocked ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button type="button" variant="ghost" size="icon-sm" disabled aria-label={tr("Cannot remove a section that holds stories")}>
                <Trash2 />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{tr("Move its")}{" "}{stories} {stories === 1 ? "story" : "stories"} {" "}{tr("to another section first")}</TooltipContent>
        </Tooltip>
      ) : (
        <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} aria-label={`Remove ${item.name || "section"}`}>
          <Trash2 />
        </Button>
      )}
    </li>
  );
}
