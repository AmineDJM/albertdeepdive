"use client";

import { useActionState, useEffect } from "react";
import { AlertCircle, Check } from "lucide-react";
import { subscribeAction, type SubscribeState } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/action-result";
import { translator, type Locale } from "@/lib/i18n";

/** The reader's language is the publication's, so it is passed in rather than read from context. */
export function SubscribeForm({ slug, accent, locale, price }: { slug: string; accent: string; locale: Locale; price?: string | null }) {
  const [state, action, pending] = useActionState<ActionResult<SubscribeState> | null, FormData>(subscribeAction, null);
  const t = translator(locale);
  const redirect = state?.ok ? state.data.redirect : undefined;

  // Stripe's checkout is Stripe's page. A full navigation, not a fetch: the reader's session with
  // Stripe starts there, and they come back through the welcome page when the payment is done.
  useEffect(() => {
    if (redirect) window.location.assign(redirect);
  }, [redirect]);

  if (redirect) {
    return <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-center text-[14px] text-muted-foreground">{t("subscribe.toCheckout")}</p>;
  }

  if (state?.ok) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-emerald-600/25 bg-emerald-50 px-4 py-3 text-[14px] text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
        <Check className="mt-0.5 size-4 shrink-0" />
        <span>{state.data.message}</span>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <div className="space-y-1.5">
        <Label htmlFor="firstName">{t("subscribe.firstName")}</Label>
        <Input id="firstName" name="firstName" autoComplete="given-name" placeholder={t("common.optional")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">{t("subscribe.email")}</Label>
        <Input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" />
      </div>
      {state && !state.ok ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" loading={pending} style={accent ? { backgroundColor: accent } : undefined}>
        {price ? t("subscribe.subscribeFor", { price }) : t("subscribe.subscribe")}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{price ? t("subscribe.paidReassurance") : t("subscribe.reassurance")}</p>
    </form>
  );
}
