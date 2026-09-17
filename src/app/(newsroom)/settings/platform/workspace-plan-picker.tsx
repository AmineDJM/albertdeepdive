"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { assignPlanAction } from "./actions";
import { NativeSelect } from "@/components/ui/native-select";

/**
 * Move one workspace onto a plan without going through Stripe.
 *
 * This is how an enterprise deal, a partnership, or a support gesture is applied. It deliberately
 * does not touch Stripe: a workspace that is also paying by card keeps its subscription, and the
 * next webhook will put it back where Stripe says it belongs.
 */
export function WorkspacePlanPicker({ organizationId, planId, plans }: { organizationId: string; planId: string | null; plans: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <NativeSelect
      aria-label="Plan"
      value={planId ?? ""}
      disabled={pending}
      className="h-7 w-[132px] text-xs"
      onChange={(e) => {
        const next = e.target.value || null;
        startTransition(async () => {
          const result = await assignPlanAction(organizationId, next);
          if (!result.ok) toast.error(result.error);
          else toast.success("Plan updated");
          router.refresh();
        });
      }}
    >
      <option value="">No plan</option>
      {plans.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </NativeSelect>
  );
}
