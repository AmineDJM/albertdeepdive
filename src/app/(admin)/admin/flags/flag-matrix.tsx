"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setPlanFlagAction } from "../organizations/actions";
import { useUi } from "@/components/i18n/provider";

export type FlagRow = { key: string; label: string; perPlan: Record<string, boolean>; overrides: number };
export type FlagPlan = { id: string; name: string };

/** Each switch is a plan edit, applied at once and read by the product on its next request. */
export function FlagMatrix({ flags, plans }: { flags: FlagRow[]; plans: FlagPlan[] }) {
  const tr = useUi();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const flip = (planId: string, key: string, enabled: boolean) =>
    startTransition(async () => {
      const result = await setPlanFlagAction(planId, key, enabled);
      if (!result.ok) toast.error(result.error ?? tr("That did not work"));
      router.refresh();
    });
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="label-caps px-3 py-2 font-medium">{tr("Feature")}</th>
            {plans.map((plan) => (
              <th key={plan.id} className="label-caps px-3 py-2 text-center font-medium">
                {plan.name}
              </th>
            ))}
            <th className="label-caps px-3 py-2 text-right font-medium">{tr("Exceptions")}</th>
          </tr>
        </thead>
        <tbody>
          {flags.map((flag) => (
            <tr key={flag.key} className="border-b border-border/70 last:border-0">
              <td className="px-3 py-2">
                <span className="block font-medium">{flag.label}</span>
                <span className="block font-mono text-2xs text-muted-foreground">{flag.key}</span>
              </td>
              {plans.map((plan) => (
                <td key={plan.id} className="px-3 py-2 text-center">
                  <Switch checked={flag.perPlan[plan.id] ?? false} disabled={pending} onCheckedChange={(checked) => flip(plan.id, flag.key, checked)} aria-label={`${flag.label} · ${plan.name}`} />
                </td>
              ))}
              <td className="tabular px-3 py-2 text-right text-xs text-muted-foreground">{flag.overrides || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
