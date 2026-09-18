"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FlatplanPageCard } from "@/components/newsroom/flatplan-page-card";
import { FlatplanInspector } from "@/components/newsroom/flatplan-inspector";
import {
  addPageAction,
  movePageAction,
  removePageAction,
  reorderPagesAction,
  setPageLockAction,
  setPageNotesAction,
  setPageStoryAction,
  setPageTemplateAction,
} from "@/app/(newsroom)/editions/[editionId]/layout/actions";
import type { Flatplan, FlatplanPage, FlatplanTemplate } from "@/server/publication/flatplan";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

/**
 * The flatplan grid: spreads in reading order (page 1 alone, then 2-3, 4-5 …). Pages produced by the
 * paginator (continuation pages) travel with the page they continue and cannot be dragged; every
 * other page can be reordered by drag-and-drop or from the page inspector.
 */

type Block = { anchorId: string; pages: FlatplanPage[] };
type Spread = { key: string; label: string; left: FlatplanPage | null; right: FlatplanPage | null };

export function FlatplanBoard({
  editionId,
  editionLabel,
  issueLabel,
  pages,
  stories,
  templates,
  canEdit,
}: {
  editionId: string;
  editionLabel: string;
  issueLabel: string;
  pages: FlatplanPage[];
  stories: Flatplan["stories"];
  templates: FlatplanTemplate[];
  canEdit: boolean;
}) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // A block is a movable page plus the pages that must follow it (planned and engine continuations).
  const blocks = useMemo(() => {
    const out: Block[] = [];
    for (const page of pages) {
      if (page.anchorIndex !== null || !out.length) out.push({ anchorId: page.id, pages: [page] });
      else out[out.length - 1].pages.push(page);
    }
    return out;
  }, [pages]);

  const anchorIds = useMemo(() => blocks.map((b) => b.anchorId), [blocks]);
  const [order, setOrder] = useOptimistic(anchorIds, (_current: string[], next: string[]) => next);

  const orderedPages = useMemo(() => {
    const byAnchor = new Map(blocks.map((b) => [b.anchorId, b]));
    const flat = order.flatMap((id) => byAnchor.get(id)?.pages ?? []);
    const missing = blocks.filter((b) => !order.includes(b.anchorId)).flatMap((b) => b.pages);
    return [...flat, ...missing].map((page, index) => (page.number === index + 1 ? page : { ...page, number: index + 1 }));
  }, [blocks, order]);

  const spreads = useMemo(() => buildSpreads(orderedPages), [orderedPages]);
  const selected = orderedPages.find((p) => p.id === selectedId) ?? null;

  const pageContext = (pageId: string) => {
    const found = orderedPages.find((p) => p.id === pageId);
    return found ? `Page ${found.number}` : undefined;
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  function run<T>(action: () => Promise<ActionResult<T>>, options: { order?: string[]; context?: string } = {}) {
    startTransition(async () => {
      if (options.order) setOrder(options.order);
      const result = await action();
      if (result.ok) {
        toast.success(result.message ?? "Saved", options.context ? { description: options.context } : undefined);
        router.refresh();
      } else {
        toast.error(result.error, options.context ? { description: options.context } : undefined);
      }
    });
  }

  function onDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    const moved = orderedPages.find((p) => p.id === String(active.id));
    run(() => reorderPagesAction(editionId, next), { order: next, context: moved ? `Page ${moved.number} moved` : undefined });
  }

  function onDragStart(event: DragStartEvent) {
    setDraggingId(String(event.active.id));
  }

  const cardProps = (page: FlatplanPage) => ({
    page,
    editionLabel,
    issueLabel,
    templates,
    canEdit,
    selected: page.id === selectedId,
    onTemplateChange: (template: string) => run(() => setPageTemplateAction(editionId, page.id, template), { context: `Page ${page.number}` }),
    onToggleLock: () => run(() => setPageLockAction(editionId, page.id, { isLocked: !page.isLocked }), { context: `Page ${page.number}` }),
    onOpen: () => setSelectedId(page.id),
  });

  return (
    <div className="relative">
      {pending ? (
        <div className="sticky top-14 z-20 mb-2 flex items-center justify-center" aria-live="polite">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs shadow-md">
            <Loader2 className="size-3.5 animate-spin text-brand" /> {" "}{tr("Saving the plan and re-running the copyfit pass…")}</span>
        </div>
      ) : null}
      <DndContext id="flatplan-board" sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-3">
            {spreads.map((spread) => (
              <section key={spread.key} className="rounded-lg border border-border/70 bg-muted/20 p-2">
                <header className="mb-1.5 flex items-center justify-between gap-2 px-0.5">
                  <h3 className="label-caps">{spread.label}</h3>
                  <span className="truncate text-2xs text-muted-foreground">{spreadCaption(spread)}</span>
                </header>
                <div className="grid grid-cols-2 gap-1">
                  {spread.left ? <PageCell {...cardProps(spread.left)} draggingId={draggingId} pending={pending} /> : <EmptyHalf />}
                  {spread.right ? <PageCell {...cardProps(spread.right)} draggingId={draggingId} pending={pending} /> : <EmptyHalf />}
                </div>
              </section>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <FlatplanInspector
        page={selected}
        pages={orderedPages}
        stories={stories}
        templates={templates}
        canEdit={canEdit}
        pending={pending}
        editionId={editionId}
        onClose={() => setSelectedId(null)}
        onTemplateChange={(pageId, template) => run(() => setPageTemplateAction(editionId, pageId, template), { context: pageContext(pageId) })}
        onToggleFlag={(pageId, patch) => run(() => setPageLockAction(editionId, pageId, patch), { context: pageContext(pageId) })}
        onMove={(pageId, direction) => run(() => movePageAction(editionId, pageId, direction), { context: pageContext(pageId) })}
        onPinStory={(pageId, storyId, pin) => run(() => setPageStoryAction(editionId, pageId, storyId, pin), { context: pageContext(pageId) })}
        onNotes={(pageId, notes) => run(() => setPageNotesAction(editionId, pageId, notes), { context: pageContext(pageId) })}
        onAddAfter={(pageId) => run(() => addPageAction(editionId, pageId), { context: pageContext(pageId) })}
        onRemove={(pageId) => {
          setSelectedId(null);
          run(() => removePageAction(editionId, pageId), { context: pageContext(pageId) });
        }}
      />
    </div>
  );
}

function PageCell({ draggingId, pending, ...props }: Parameters<typeof FlatplanPageCard>[0] & { draggingId: string | null }) {
  const movable = props.canEdit && props.page.anchorIndex !== null;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: props.page.id, disabled: !movable });
  return (
    <div ref={movable ? setNodeRef : undefined} style={movable ? { transform: CSS.Transform.toString(transform), transition } : undefined} className={cn(isDragging && "z-20")}>
      <FlatplanPageCard
        {...props}
        pending={pending}
        dragging={isDragging || draggingId === props.page.id}
        dragHandleRef={movable ? setActivatorNodeRef : undefined}
        dragHandleProps={movable ? { ...attributes, ...listeners } : undefined}
      />
    </div>
  );
}

function EmptyHalf() {
  const tr = useUi();
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-border/70 p-2 text-2xs text-muted-foreground">
      <span className="flex aspect-[210/297] w-full items-center justify-center">{tr("Outside cover")}</span>
    </div>
  );
}

function spreadCaption(spread: Spread) {
  const names = [spread.left?.section?.name, spread.right?.section?.name].filter((n): n is string => !!n);
  return [...new Set(names)].join(" · ");
}

/** Page 1 sits alone on the right, then pages pair up (2-3, 4-5 …) as they do on press. */
function buildSpreads(pages: FlatplanPage[]): Spread[] {
  const byNumber = new Map(pages.map((p) => [p.number, p]));
  const spreads: Spread[] = [];
  if (!pages.length) return spreads;
  spreads.push({ key: "spread-1", label: "Page 1 · cover", left: null, right: byNumber.get(1) ?? null });
  for (let n = 2; n <= pages.length; n += 2) {
    const left = byNumber.get(n) ?? null;
    const right = byNumber.get(n + 1) ?? null;
    spreads.push({ key: `spread-${n}`, label: right ? `Pages ${n}–${n + 1}` : `Page ${n}`, left, right });
  }
  return spreads;
}
