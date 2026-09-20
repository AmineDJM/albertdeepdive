"use client";

import { useFormStatus } from "react-dom";
import { Loader2, Plus } from "lucide-react";
import { prepareEditionAction } from "@/app/(newsroom)/editions/actions";
import { Button } from "@/components/ui/button";
import { useUi } from "@/components/i18n/provider";

function Submit({ label, variant, size }: { label: string; variant?: "default" | "outline"; size?: "default" | "sm" | "lg" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant={variant} size={size} data-testid="new-edition">
      {pending ? <Loader2 className="animate-spin" /> : <Plus />} {label}
    </Button>
  );
}

/**
 * "+ New edition", and Briefly prepares it.
 *
 * One click: no month to pick, no issue number, no page count. The next edition is made from
 * what the workspace already knows and opened, where each of those decisions is one line with a
 * "Change". The button is a form so it works before any script runs.
 */
export function NewEditionButton({ label, variant, size, publicationId }: { label?: string; variant?: "default" | "outline"; size?: "default" | "sm" | "lg"; /** The newsletter this edition belongs to. Without one, the workspace's first title. */ publicationId?: string }) {
  const tr = useUi();
  return (
    <form action={prepareEditionAction}>
      {publicationId ? <input type="hidden" name="publicationId" value={publicationId} /> : null}
      <Submit label={label ?? tr("New edition")} variant={variant} size={size} />
    </form>
  );
}
