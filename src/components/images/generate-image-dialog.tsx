"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useUi } from "@/components/i18n/provider";
import { generateImageAction } from "@/app/(newsroom)/images/actions";
import { ImageComposer } from "./image-composer";
import type { ReferenceCandidate } from "@/server/images/views";

/** "Generate image": one sentence, and the picture lands in the library when it is ready. */
export function GenerateImageDialog({ editionId, candidates, variant = "outline" }: { editionId: string | null; candidates: ReferenceCandidate[]; variant?: "outline" | "default" | "brand" }) {
  const tr = useUi();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="sm">
          <Sparkles /> {tr("Generate image")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{tr("Generate image")}</DialogTitle>
          <DialogDescription>{tr("Describe the picture in plain words. Real photographs from the library always come first; a generated one is for what nobody photographed.")}</DialogDescription>
        </DialogHeader>
        <ImageComposer mode="generate" candidates={candidates} onSubmit={(input) => generateImageAction({ editionId, instruction: input.instruction, references: input.references, advanced: input.advanced, size: input.size })} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
