"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingsCard } from "@/components/settings/key-value";
import { applyMonthlyDefaultsAction } from "@/app/(newsroom)/editions/[editionId]/settings/actions";
import { useUi } from "@/components/i18n/provider";

export type ScheduleComparison = {
  key: string;
  label: string;
  current: string | null;
  fromDefaults: string;
  matches: boolean;
};

/** The monthly campaign defaults applied to this edition, next to the dates the campaign actually uses. */
export function EditionSettingsCampaign({
  editionId,
  rows,
  campaignStatus,
  canManage,
  defaultsSummary,
}: {
  editionId: string;
  rows: ScheduleComparison[];
  campaignStatus: string | null;
  canManage: boolean;
  defaultsSummary: string;
}) {
  const tr = useUi();
  const router = useRouter();
  const [pending, start] = useTransition();
  const drifted = rows.filter((r) => !r.matches).length;
  // Once a campaign is open the service refuses a new opening date, so rebuilding the schedule is off.
  const locked = campaignStatus !== null && campaignStatus !== "DRAFT" && campaignStatus !== "SCHEDULED";

  return (
    <SettingsCard
      title={tr("Campaign defaults")}
      description={`System defaults: ${defaultsSummary}`}
      action={
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost">
            <Link href={`/editions/${editionId}/campaign`}>
              {tr("Campaign")}{" "}<ArrowRight />
            </Link>
          </Button>
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              loading={pending}
              disabled={locked}
              title={locked ? `The campaign is ${campaignStatus?.toLowerCase().replace(/_/g, " ")} — its dates can no longer be rebuilt` : undefined}
              onClick={() =>
                start(async () => {
                  const res = await applyMonthlyDefaultsAction(editionId);
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  toast.success(res.message);
                  router.refresh();
                })
              }
            >
              <RotateCcw /> {" "}{tr("Apply to this edition")}</Button>
          ) : null}
        </div>
      }
    >
      <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-[13px]">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="flex items-center gap-3">
              <span className="tabular text-2xs text-muted-foreground">{r.fromDefaults}</span>
              {r.current ? (
                r.matches ? (
                  <Badge variant="muted">{tr("Follows the default")}</Badge>
                ) : (
                  <Badge variant="warning" className="tabular">
                    {tr("now")}{" "}{r.current}
                  </Badge>
                )
              ) : (
                <Badge variant="secondary">{tr("Not scheduled")}</Badge>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-2xs text-muted-foreground">
        {campaignStatus === null
          ? "This edition has no campaign yet — applying the defaults creates one."
          : drifted === 0
            ? "This edition follows the monthly schedule."
            : `${drifted} date${drifted === 1 ? " differs" : "s differ"} from the monthly defaults. Applying them overwrites the campaign dates; the pools and targets are kept.`}{" "}
        {tr("Change the defaults for every edition in")}{" "}
        <Link href="/settings/system" className="text-brand hover:underline">
          {tr("Settings → System")}</Link>
        .
      </p>
    </SettingsCard>
  );
}
