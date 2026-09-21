"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ModelSpecimen } from "@/components/design/model-specimen";
import type { ModelShelf } from "@/server/design/models/service";
import { adoptModelAction } from "./actions";
import { useUi } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * The shelf, as cards.
 *
 * The workspace's own model comes first and is marked as such, because for most customers it is
 * the right answer and the six after it are alternatives rather than a menu to work through. Each
 * card is a page rather than a swatch: you cannot tell whether a model suits your newsletter from
 * three colours and a font name.
 */
export function ModelGallery({ shelf, canAdopt }: { shelf: ModelShelf; canAdopt: boolean }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();

  const names: Record<string, string> = {
    brand: tr("Your brand"),
    editorial: tr("Editorial"),
    modern: tr("Modern"),
    minimal: tr("Minimal"),
    classic: tr("Classic"),
    bold: tr("Bold"),
    playful: tr("Playful"),
  };
  const notes: Record<string, string> = {
    brand: tr("Composed from your own colours and type. Changes when your brand does."),
    editorial: tr("A magazine voice. Serif headlines, a measured page, pictures that serve the writing."),
    modern: tr("Swiss and quiet. One grotesque doing everything, plenty of air, very little ornament."),
    minimal: tr("As little as possible. No rules, no boxes, almost no colour — the type carries it."),
    classic: tr("Formal and dense. The page of a publication that has been arriving for thirty years."),
    bold: tr("Loud on purpose. Big type, full colour, led by the picture."),
    playful: tr("Warm and informal. Softer shapes, more colour, a page that is pleased to see you."),
  };

  function adopt(id: string) {
    start(async () => {
      const result = await adoptModelAction(shelf.publicationId, id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="model-gallery">
      {shelf.cards.map((card) => (
        <div
          key={card.id}
          data-testid={`model-card-${card.id}`}
          className={cn(
            "flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors",
            card.current ? "border-brand shadow-xs" : "border-border hover:border-brand/50",
          )}
        >
          <ModelSpecimen specimen={card.specimen} personality={card.personality} colours={shelf.colours} title={shelf.publicationName} />
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold">
                {card.kind === "brand" ? <Sparkles className="size-3.5 shrink-0" /> : null}
                {names[card.id] ?? card.id}
                {card.current ? (
                  <Badge variant="outline" className="gap-1">
                    <Check className="size-3" /> {tr("In use")}
                  </Badge>
                ) : null}
              </p>
              <p className="mt-0.5 text-2xs text-muted-foreground">{notes[card.id] ?? ""}</p>
            </div>
          </div>
          {/*
            * Said on every card rather than once at the top: a person scrolling a grid of pages
            * reads the page, not the paragraph above it, and a sample that does not say it is one
            * is a claim about a newsletter that has not been written.
            */}
          <p className="text-2xs text-muted-foreground/70">{tr("Sample words, your title, your colours.")}</p>
          {canAdopt && !card.current ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => adopt(card.id)} data-testid={`adopt-model-${card.id}`}>
              {tr("Make my newsletter on this")}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
