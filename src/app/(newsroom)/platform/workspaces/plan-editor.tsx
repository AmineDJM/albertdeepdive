"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { setDefaultPlanAction, updatePlanAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useUi } from "@/components/i18n/provider";

export type EditablePlan = {
  id: string;
  key: string;
  name: string;
  tagline: string | null;
  priceMonthlyCents: number;
  priceYearlyCents: number;
  currency: string;
  stripeMonthlyPriceId: string | null;
  stripeYearlyPriceId: string | null;
  entitlements: Record<string, unknown>;
  highlights: string[];
  isPublic: boolean;
  isFeatured: boolean;
  isDefault: boolean;
  trialDays: number;
};

const euros = (cents: number) => (cents / 100).toFixed(2);

/**
 * Editing a plan changes what customers are charged and what they may do, so the whole thing is one
 * explicit save rather than a set of fields that apply as you type.
 *
 * Entitlements are edited as JSON on purpose: they grow a key whenever the product grows a feature,
 * and a hand-maintained form would be permanently one release behind.
 */
export function PlanEditor({ plan }: { plan: EditablePlan }) {
  const tr = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(plan.name);
  const [tagline, setTagline] = useState(plan.tagline ?? "");
  const [monthly, setMonthly] = useState(euros(plan.priceMonthlyCents));
  const [yearly, setYearly] = useState(euros(plan.priceYearlyCents));
  const [monthlyPriceId, setMonthlyPriceId] = useState(plan.stripeMonthlyPriceId ?? "");
  const [yearlyPriceId, setYearlyPriceId] = useState(plan.stripeYearlyPriceId ?? "");
  const [highlights, setHighlights] = useState(plan.highlights.join("\n"));
  const [entitlements, setEntitlements] = useState(JSON.stringify(plan.entitlements, null, 2));
  const [isPublic, setIsPublic] = useState(plan.isPublic);
  const [isFeatured, setIsFeatured] = useState(plan.isFeatured);
  const [trialDays, setTrialDays] = useState(String(plan.trialDays));
  const [jsonError, setJsonError] = useState<string | null>(null);

  function submit() {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(entitlements);
    } catch {
      setJsonError("That is not valid JSON.");
      return;
    }
    setJsonError(null);
    startTransition(async () => {
      const result = await updatePlanAction(plan.id, {
        name,
        tagline: tagline || null,
        priceMonthlyCents: Math.round(Number(monthly) * 100) || 0,
        priceYearlyCents: Math.round(Number(yearly) * 100) || 0,
        stripeMonthlyPriceId: monthlyPriceId || null,
        stripeYearlyPriceId: yearlyPriceId || null,
        highlights: highlights.split("\n").map((l) => l.trim()).filter(Boolean),
        entitlements: parsed,
        isPublic,
        isFeatured,
        trialDays: Math.max(0, Math.floor(Number(trialDays) || 0)),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name} saved`);
      setOpen(false);
      router.refresh();
    });
  }

  function makeDefault() {
    startTransition(async () => {
      const result = await setDefaultPlanAction(plan.id);
      if (!result.ok) toast.error(result.error);
      else toast.success(`${plan.name} is the default plan`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${plan.name}`}>
          <Pencil />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan.name}</DialogTitle>
          <DialogDescription>
            {tr("Changes apply to every workspace on this plan, and to the public pricing page. Key:")}{" "}<span className="font-mono">{plan.key}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pl-name">{tr("Name")}</Label>
              <Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-trial">{tr("Trial days")}</Label>
              <Input id="pl-trial" value={trialDays} onChange={(e) => setTrialDays(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-tagline">{tr("Tagline")}</Label>
            <Input id="pl-tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pl-monthly">{tr("Monthly (")}{plan.currency})</Label>
              <Input id="pl-monthly" value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-yearly">{tr("Yearly (")}{plan.currency})</Label>
              <Input id="pl-yearly" value={yearly} onChange={(e) => setYearly(e.target.value)} inputMode="decimal" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-sm">{tr("Stripe monthly price")}</Label>
              <Input id="pl-sm" value={monthlyPriceId} onChange={(e) => setMonthlyPriceId(e.target.value)} placeholder={tr("price_…")} className="font-mono text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pl-sy">{tr("Stripe yearly price")}</Label>
              <Input id="pl-sy" value={yearlyPriceId} onChange={(e) => setYearlyPriceId(e.target.value)} placeholder={tr("price_…")} className="font-mono text-xs" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-highlights">{tr("Highlights (one per line)")}</Label>
            <Textarea id="pl-highlights" rows={5} value={highlights} onChange={(e) => setHighlights(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pl-entitlements">{tr("Entitlements")}</Label>
            <Textarea id="pl-entitlements" rows={12} value={entitlements} onChange={(e) => setEntitlements(e.target.value)} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{tr("null")}</span>{" "}{tr("means unlimited;")}{" "}<span className="font-mono">0</span>{" "}{tr("means none.")}</p>
            {jsonError ? <p className="text-xs text-destructive">{jsonError}</p> : null}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label htmlFor="pl-public">{tr("Shown on the pricing page")}</Label>
              <Switch id="pl-public" checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <Label htmlFor="pl-featured">{tr("Marked “most popular”")}</Label>
              <Switch id="pl-featured" checked={isFeatured} onCheckedChange={setIsFeatured} />
            </div>
            {!plan.isDefault && plan.priceMonthlyCents === 0 ? (
              <Button variant="outline" size="sm" className="w-full" onClick={makeDefault} disabled={pending}>
                {tr("Make this the default plan")}</Button>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tr("Cancel")}</Button>
          <Button onClick={submit} loading={pending}>
            {tr("Save plan")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
