"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Sparkles } from "lucide-react";
import { createPackAction, generatePackAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { CREATIVE_FORMATS, CREATIVE_MODES, FORMATS, MODES, type CreativeFormat, type CreativeMode } from "@/lib/creative/formats";
import { DESIGN_SYSTEMS, SYSTEMS } from "@/lib/creative/design-systems";
import { MOTION, MOTION_SYSTEMS } from "@/lib/creative/motion";
import { cn } from "@/lib/utils";
import { useUi } from "@/components/i18n/provider";

/**
 * Making something.
 *
 * Four decisions, in the order they matter: what it is made from, what shape it is, how it is set,
 * and how much Briefly is allowed to invent. Everything else — the colours, the type, the sizes, the
 * words — comes from the brand and the editorial, which is the point.
 *
 * One button does the whole thing: create, direct, compose, queue. Splitting those in the interface
 * would expose a pipeline nobody asked to see.
 */
export function NewPackDialog({ editions }: { editions: { id: string; label: string }[] }) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [editionId, setEditionId] = useState(editions[0]?.id ?? "");
  const [format, setFormat] = useState<CreativeFormat>("CAROUSEL");
  const [system, setSystem] = useState<string>("editorial");
  const [mode, setMode] = useState<CreativeMode>("STUDIO");
  const [motion, setMotion] = useState<string>("cut");
  const [angle, setAngle] = useState("");

  // Every shape, moving or not. A Reel is the same frames with time added, so there is no reason to
  // hide it behind a different flow.
  const shapes = CREATIVE_FORMATS;
  const moving = FORMATS[format].moving;

  function submit() {
    startTransition(async () => {
      const created = await createPackAction({
        name: name.trim() || `${FORMATS[format].name} — ${editions.find((edition) => edition.id === editionId)?.label ?? "untitled"}`,
        format,
        mode,
        system,
        motion,
        editionId: editionId || null,
      });
      if (!created.ok) {
        toast.error(created.error);
        return;
      }
      const generated = await generatePackAction(created.data.id, angle);
      if (!generated.ok) {
        toast.error(generated.error);
        router.push(`/studio/${created.data.id}`);
        return;
      }
      toast.success(generated.message ?? "Made");
      setOpen(false);
      router.push(`/studio/${created.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> {" "}{tr("Make something")}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("Make something")}</DialogTitle>
          <DialogDescription>{tr("Briefly reads what you published, writes the frames and draws every one of them in your own colours and type.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="pack-edition">{tr("From")}</Label>
              <NativeSelect id="pack-edition" value={editionId} disabled={pending} onChange={(e) => setEditionId(e.target.value)} className="mt-1">
                {editions.length ? null : <option value="">{tr("No editions yet")}</option>}
                {editions.map((edition) => (
                  <option key={edition.id} value={edition.id}>
                    {edition.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div>
              <Label htmlFor="pack-name">{tr("Called")}</Label>
              <Input id="pack-name" value={name} disabled={pending} placeholder={tr("October carousel")} onChange={(e) => setName(e.target.value)} className="mt-1" />
            </div>
          </div>

          <div>
            <Label>{tr("Shape")}</Label>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
              {shapes.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={pending}
                  aria-pressed={format === key}
                  onClick={() => setFormat(key)}
                  className={cn("rounded-lg border p-2.5 text-left transition-colors", format === key ? "border-brand bg-brand-soft/40" : "border-border hover:bg-muted/50")}
                >
                  <span className="block text-[13px] font-medium">{FORMATS[key].name}</span>
                  <span className="block text-2xs text-muted-foreground">
                    {FORMATS[key].width}×{FORMATS[key].height}
                    {FORMATS[key].moving ? " · moves" : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>{tr("Set like")}</Label>
            <div className="mt-1.5 space-y-1.5">
              {DESIGN_SYSTEMS.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={pending}
                  aria-pressed={system === key}
                  onClick={() => setSystem(key)}
                  className={cn("flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors", system === key ? "border-brand bg-brand-soft/40" : "border-border hover:bg-muted/50")}
                >
                  <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                    {system === key ? <span className="size-1.5 rounded-full bg-brand" /> : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{SYSTEMS[key].name}</span>
                    <span className="block text-2xs text-muted-foreground">{SYSTEMS[key].description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {moving ? (
            <div>
              <Label>{tr("Moves like")}</Label>
              <div className="mt-1.5 space-y-1.5">
                {MOTION_SYSTEMS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={pending}
                    aria-pressed={motion === key}
                    onClick={() => setMotion(key)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors",
                      motion === key ? "border-brand bg-brand-soft/40" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-full border border-border bg-background">
                      {motion === key ? <span className="size-1.5 rounded-full bg-brand" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{MOTION[key].name}</span>
                      <span className="block text-2xs text-muted-foreground">{MOTION[key].description}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-2xs text-muted-foreground">
                {tr("Each scene is held for as long as its words take to read, so the length follows the writing rather than a stopwatch.")}</p>
            </div>
          ) : null}

          <div>
            <Label htmlFor="pack-mode">{tr("How much we invent")}</Label>
            <NativeSelect id="pack-mode" value={mode} disabled={pending} onChange={(e) => setMode(e.target.value as CreativeMode)} className="mt-1">
              {CREATIVE_MODES.map((key) => (
                <option key={key} value={key}>
                  {MODES[key].name} — {MODES[key].description}
                </option>
              ))}
            </NativeSelect>
            {MODES[mode].caution ? <p className="mt-1 text-2xs text-muted-foreground">{MODES[mode].caution}</p> : null}
          </div>

          <div>
            <Label htmlFor="pack-angle">{tr("Angle")}</Label>
            <Input id="pack-angle" value={angle} disabled={pending} placeholder={tr("Lead with the alum, keep it short")} onChange={(e) => setAngle(e.target.value)} className="mt-1" />
            <p className="mt-1 text-2xs text-muted-foreground">{tr("Optional. A steer for what to lead with, not a description of how it should look.")}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={pending}>
            {tr("Cancel")}</Button>
          <Button size="sm" onClick={submit} loading={pending} disabled={!editions.length}>
            <Sparkles /> {pending ? "Making…" : "Make it"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
