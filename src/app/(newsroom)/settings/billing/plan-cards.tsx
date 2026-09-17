"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { openPortalAction, setCancelAction, startCheckoutAction } from "./actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PlanCard = {
  key: string;
  name: string;
  tagline: string | null;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  highlights: string[];
  isFeatured: boolean;
  isCustomPriced: boolean;
  purchasable: boolean;
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

/**
 * Choosing a plan.
 *
 * Yearly is shown as a monthly figure with the saving spelled out, because "€564 a year" is harder
 * to compare against "€59 a month" than it needs to be.
 */
export function PlanCards({ plans, currentKey, canManage, hasStripeCustomer, cancelAtPeriodEnd, stripeReady }: { plans: PlanCard[]; currentKey: string; canManage: boolean; hasStripeCustomer: boolean; cancelAtPeriodEnd: boolean; stripeReady: boolean }) {
  const router = useRouter();
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function upgrade(planKey: string) {
    setBusy(planKey);
    startTransition(async () => {
      const result = await startCheckoutAction(planKey, interval);
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.location.href = result.data.url;
    });
  }

  function portal() {
    setBusy("portal");
    startTransition(async () => {
      const result = await openPortalAction();
      setBusy(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.location.href = result.data.url;
    });
  }

  function toggleCancel() {
    startTransition(async () => {
      const result = await setCancelAction(!cancelAtPeriodEnd);
      if (!result.ok) toast.error(result.error);
      else toast.success(cancelAtPeriodEnd ? "Subscription resumed" : "Subscription will end at the end of the period");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {(["month", "year"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setInterval(value)}
              className={cn("rounded-[5px] px-3 py-1 text-[13px] transition-colors", interval === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {value === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
        {hasStripeCustomer && canManage ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" loading={pending && busy === "portal"} onClick={portal}>
              Invoices and payment method
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleCancel} disabled={pending}>
              {cancelAtPeriodEnd ? "Resume subscription" : "Cancel subscription"}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-4">
        {plans.map((plan) => {
          const current = plan.key === currentKey;
          const cents = interval === "year" ? plan.priceYearlyCents : plan.priceMonthlyCents;
          const perMonth = interval === "year" ? Math.round(plan.priceYearlyCents / 12) : plan.priceMonthlyCents;
          const saving = plan.priceMonthlyCents > 0 && plan.priceYearlyCents > 0 ? Math.round(100 - (plan.priceYearlyCents / (plan.priceMonthlyCents * 12)) * 100) : 0;
          return (
            <div
              key={plan.key}
              className={cn(
                "flex flex-col rounded-lg border p-4",
                current ? "border-foreground/30 bg-card shadow-xs" : plan.isFeatured ? "border-foreground/20 bg-card" : "border-border bg-card/50",
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[14px] font-semibold">{plan.name}</span>
                {plan.isFeatured && !current ? (
                  <span className="inline-flex items-center gap-0.5 rounded-sm bg-foreground px-1.5 py-0.5 text-2xs font-medium text-background">
                    <Sparkles className="size-2.5" /> Popular
                  </span>
                ) : null}
                {current ? <span className="rounded-sm bg-emerald-600/10 px-1.5 py-0.5 text-2xs font-medium text-emerald-700 dark:text-emerald-400">Current</span> : null}
              </div>
              {plan.tagline ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{plan.tagline}</p> : null}

              <div className="mt-3">
                {plan.isCustomPriced ? (
                  <p className="text-[22px] font-semibold tracking-tight">Custom</p>
                ) : (
                  <>
                    <p className="text-[22px] font-semibold tracking-tight">
                      {money(perMonth, plan.currency)}
                      <span className="text-[13px] font-normal text-muted-foreground"> / month</span>
                    </p>
                    {interval === "year" && cents > 0 ? (
                      <p className="mt-0.5 text-2xs text-muted-foreground">
                        {money(cents, plan.currency)} billed yearly{saving > 0 ? ` · save ${saving}%` : ""}
                      </p>
                    ) : null}
                  </>
                )}
              </div>

              <ul className="mt-3 flex-1 space-y-1.5">
                {plan.highlights.map((line) => (
                  <li key={line} className="flex items-start gap-1.5 text-xs leading-5">
                    <Check className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                {current ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Your plan
                  </Button>
                ) : plan.isCustomPriced ? (
                  <Button variant="outline" size="sm" className="w-full" asChild>
                    <a href="mailto:sales@briefly.press?subject=Briefly%20Enterprise">Contact us</a>
                  </Button>
                ) : plan.priceMonthlyCents === 0 ? (
                  <Button variant="outline" size="sm" className="w-full" disabled>
                    Included
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!canManage || !stripeReady || !plan.purchasable}
                    loading={pending && busy === plan.key}
                    onClick={() => upgrade(plan.key)}
                    title={!stripeReady ? "Payments are not set up on this Briefly yet" : !plan.purchasable ? "This plan has no price configured yet" : undefined}
                  >
                    Choose {plan.name}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!canManage ? <p className="text-xs text-muted-foreground">Only an owner or admin of this workspace can change the plan.</p> : null}
      {canManage && !stripeReady ? <p className="text-xs text-muted-foreground">Payments are not configured on this installation, so plans cannot be bought here yet.</p> : null}
    </div>
  );
}
