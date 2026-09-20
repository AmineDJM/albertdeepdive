"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import { subscribeShelfAction, type ShelfState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";
import { translator, type Locale } from "@/lib/i18n";

export type ShelfTitle = { id: string; name: string; description: string | null };

/** One address, as many newsletters as they tick. */
export function ShelfForm({ orgSlug, titles, accent, locale }: { orgSlug: string; titles: ShelfTitle[]; accent: string; locale: Locale }) {
  const [state, action, pending] = useActionState<ActionResult<ShelfState> | null, FormData>(subscribeShelfAction, null);
  const [chosen, setChosen] = useState<string[]>(titles.length === 1 ? [titles[0].id] : []);
  const t = translator(locale);

  if (state?.ok) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-emerald-600/25 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
        <Check className="mt-0.5 size-4 shrink-0" />
        <span>{state.data.message}</span>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <fieldset className="space-y-1.5">
        <legend className="mb-1.5 text-[13px] font-medium">{t("subscribe.pickTitles")}</legend>
        {titles.map((title) => (
          <label key={title.id} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:border-foreground/25 has-[:checked]:border-foreground/40">
            <input
              type="checkbox"
              name="publicationIds"
              value={title.id}
              checked={chosen.includes(title.id)}
              onChange={(event) => setChosen((current) => (event.target.checked ? [...current, title.id] : current.filter((id) => id !== title.id)))}
              className="mt-0.5 size-4 accent-[var(--brand)]"
            />
            <span className="min-w-0">
              <span className="block text-[14px] font-medium">{title.name}</span>
              {title.description ? <span className="mt-0.5 block text-xs text-muted-foreground">{title.description}</span> : null}
            </span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="firstName">{t("subscribe.firstName")}</Label>
        <Input id="firstName" name="firstName" autoComplete="given-name" placeholder={t("common.optional")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("subscribe.email")}</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" placeholder="vous@exemple.fr" />
      </div>

      {state && !state.ok ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!chosen.length} style={accent ? { backgroundColor: accent } : undefined}>
        {t("subscribe.subscribe")}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t("subscribe.reassurance")}</p>
    </form>
  );
}
