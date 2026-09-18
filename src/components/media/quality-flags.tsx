import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { explainQualityFlag, flagLabel } from "@/server/media/constants";
import { getUi } from "@/server/i18n/locale";

const DUP_FLAGS = new Set(["EXACT_DUPLICATE", "NEAR_DUPLICATE", "SIMILAR_IMAGE"]);

/** Quality flag chips with a plain-English explanation on hover / focus. */
export async function QualityFlags({ flags, className }: { flags: string[]; className?: string }) {
  const tr = await getUi();
  if (!flags.length)
    return <span className="text-muted-foreground text-xs">{tr("No issues detected")}</span>;
  return (
    <div className={className ?? "flex flex-wrap gap-1"}>
      {flags.map((f) => (
        <Tooltip key={f}>
          <TooltipTrigger asChild>
            <Badge
              variant={
                DUP_FLAGS.has(f) ? "info" : f === "EXTREME_ASPECT_RATIO" ? "secondary" : "warning"
              }
              tabIndex={0}
              className="cursor-help"
            >
              {flagLabel(f)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{explainQualityFlag(f)}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
