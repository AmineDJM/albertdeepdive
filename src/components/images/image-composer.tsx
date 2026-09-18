"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Sparkles, WandSparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLocale, useUi } from "@/components/i18n/provider";
import { cn } from "@/lib/utils";
import type { ReferenceRole } from "@/lib/images/types";
import type { ReferenceCandidate } from "@/server/images/views";
import type { ActionResult } from "@/lib/action-result";

/**
 * Asking for a picture, or for a change to one.
 *
 * One sentence in plain words is the whole interface: "a warm photograph of the campus at dusk",
 * "make the sky bluer", "remove the person on the left". Nothing here names a model. Advanced is
 * three dials for the person who wants them — how much to protect, how many to try, how real —
 * and references are the workspace's own pictures pointed at with a role: this face, this product,
 * this style.
 */

const ROLE_WORDS: Record<Exclude<ReferenceRole, "original_master" | "current_version">, { en: string; fr: string }> = {
  identity_reference: { en: "This person", fr: "Cette personne" },
  product_reference: { en: "This product", fr: "Ce produit" },
  style_reference: { en: "This style", fr: "Ce style" },
  composition_reference: { en: "This composition", fr: "Cette composition" },
  brand_reference: { en: "This brand", fr: "Cette marque" },
};
const ROLES = Object.keys(ROLE_WORDS) as (keyof typeof ROLE_WORDS)[];

export type ComposerAdvanced = { latitude: number; variations: number | null; realism: number | null };
export type ComposerSubmit = (input: { instruction: string; references: { role: ReferenceRole; mediaId: string }[]; advanced: ComposerAdvanced; size: "square" | "landscape" | "portrait" | "story" }) => Promise<ActionResult<{ id: string }>>;

export function ImageComposer({ mode, candidates, onSubmit, onDone, placeholder, submitLabel, compact = false }: { mode: "generate" | "edit"; candidates: ReferenceCandidate[]; onSubmit: ComposerSubmit; onDone?: () => void; placeholder?: string; submitLabel?: string; compact?: boolean }) {
  const tr = useUi();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [instruction, setInstruction] = useState("");
  const [references, setReferences] = useState<{ role: keyof typeof ROLE_WORDS; mediaId: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [latitude, setLatitude] = useState(0);
  const [variations, setVariations] = useState<number | null>(null);
  const [realism, setRealism] = useState<number | null>(null);
  const [size, setSize] = useState<"square" | "landscape" | "portrait" | "story">("landscape");

  const submit = () => {
    if (instruction.trim().length < 3) {
      toast.error(tr("Say what you want in a few words."));
      return;
    }
    startTransition(async () => {
      const result = await onSubmit({ instruction: instruction.trim(), references, advanced: { latitude, variations, realism }, size });
      if (!result.ok) {
        toast.error(result.error ?? tr("That did not work"));
        return;
      }
      toast.success(result.message);
      setInstruction("");
      setReferences([]);
      onDone?.();
      router.refresh();
    });
  };

  const available = candidates.filter((candidate) => !references.some((reference) => reference.mediaId === candidate.id));

  return (
    <div className={cn("space-y-3", compact && "space-y-2.5")} data-testid={`image-composer-${mode}`}>
      <div className="space-y-1.5">
        <Label htmlFor={`image-${mode}-instruction`}>{mode === "generate" ? tr("What picture do you need?") : tr("What should change?")}</Label>
        <Textarea
          id={`image-${mode}-instruction`}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          rows={compact ? 2 : 3}
          maxLength={1200}
          placeholder={placeholder ?? (mode === "generate" ? tr("A warm photograph of students working late on the campus terrace, city lights behind them") : tr("Make the sky a little bluer and remove the bin on the left"))}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit();
          }}
        />
        {mode === "edit" ? <p className="text-2xs text-muted-foreground">{tr("Everything you do not mention stays as it is. The original is never touched: each change is a new version you can go back from.")}</p> : <p className="text-2xs text-muted-foreground">{tr("Words and logos are never drawn by the picture engine: the design engine sets them afterwards, in the brand's type.")}</p>}
      </div>

      {references.length ? (
        <ul className="flex flex-wrap gap-2">
          {references.map((reference) => {
            const candidate = candidates.find((entry) => entry.id === reference.mediaId);
            return (
              <li key={reference.mediaId} className="flex items-center gap-2 rounded-md border border-border bg-card p-1 pr-2 text-xs">
                {candidate?.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={candidate.thumbUrl} alt="" className="size-8 rounded object-cover" />
                ) : null}
                <NativeSelect value={reference.role} onChange={(event) => setReferences((all) => all.map((entry) => (entry.mediaId === reference.mediaId ? { ...entry, role: event.target.value as keyof typeof ROLE_WORDS } : entry)))} className="h-7 text-xs" aria-label={tr("Reference role")}>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_WORDS[role][locale]}
                    </option>
                  ))}
                </NativeSelect>
                <span className="max-w-32 truncate">{candidate?.label ?? reference.mediaId}</span>
                <button type="button" onClick={() => setReferences((all) => all.filter((entry) => entry.mediaId !== reference.mediaId))} className="text-muted-foreground hover:text-foreground" aria-label={tr("Remove reference")}>
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {candidates.length ? (
        <div>
          <Button type="button" variant="ghost" size="xs" onClick={() => setPicking((open) => !open)} disabled={!available.length && !picking}>
            <ChevronRight className={cn("size-3.5 transition-transform", picking && "rotate-90")} />
            {tr("Point at a reference")}
            <span className="text-muted-foreground">· {tr("a face, a product, a style to keep")}</span>
          </Button>
          {picking ? (
            <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {available.slice(0, 18).map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="block w-full overflow-hidden rounded-md border border-border bg-muted text-left hover:ring-2 hover:ring-brand focus-visible:ring-2 focus-visible:ring-brand"
                    onClick={() => {
                      setReferences((all) => (all.length >= 6 ? all : [...all, { role: candidate.kind === "logo" ? "brand_reference" : "identity_reference", mediaId: candidate.id }]));
                      if (available.length <= 1) setPicking(false);
                    }}
                    title={candidate.label}
                  >
                    {candidate.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={candidate.thumbUrl} alt={candidate.label} className="aspect-square w-full object-cover" />
                    ) : (
                      <span className="block aspect-square w-full" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="xs">
            <ChevronRight className={cn("size-3.5 transition-transform", advancedOpen && "rotate-90")} />
            {tr("Advanced")}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 grid gap-3 rounded-md border border-border bg-muted/40 p-3 sm:grid-cols-2">
            {mode === "edit" ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <Label htmlFor={`image-${mode}-latitude`}>{tr("Preserve more")}</Label>
                  <span className="text-muted-foreground">{tr("Change more")}</span>
                </div>
                <input id={`image-${mode}-latitude`} type="range" min={-1} max={1} step={0.25} value={latitude} onChange={(event) => setLatitude(Number(event.target.value))} className="w-full accent-brand" />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor={`image-${mode}-size`}>{tr("Shape")}</Label>
                <NativeSelect id={`image-${mode}-size`} value={size} onChange={(event) => setSize(event.target.value as typeof size)}>
                  <option value="landscape">{tr("Landscape")}</option>
                  <option value="square">{tr("Square")}</option>
                  <option value="portrait">{tr("Portrait")}</option>
                  <option value="story">{tr("Story (9:16)")}</option>
                </NativeSelect>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor={`image-${mode}-variations`}>{tr("Variations")}</Label>
              <NativeSelect id={`image-${mode}-variations`} value={variations ?? ""} onChange={(event) => setVariations(event.target.value ? Number(event.target.value) : null)}>
                <option value="">{tr("Let Briefly decide")}</option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <Label htmlFor={`image-${mode}-realism`}>{tr("Stylised")}</Label>
                <span className="text-muted-foreground">{tr("Photographic")}</span>
              </div>
              <input id={`image-${mode}-realism`} type="range" min={0} max={1} step={0.25} value={realism ?? 0.5} onChange={(event) => setRealism(Number(event.target.value))} className="w-full accent-brand" />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={submit} disabled={pending} size="sm">
          {mode === "generate" ? <Sparkles /> : <WandSparkles />}
          {submitLabel ?? (mode === "generate" ? tr("Generate image") : tr("Apply the change"))}
        </Button>
        <span className="text-2xs text-muted-foreground">{tr("⌘↵ to send")}</span>
      </div>
    </div>
  );
}
