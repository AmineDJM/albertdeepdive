import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { explainQualityFlag, flagLabel } from "@/server/media/constants";

const DUP_FLAGS = new Set(["EXACT_DUPLICATE", "NEAR_DUPLICATE", "SIMILAR_IMAGE"]);

/** Quality flag chips with a plain-English explanation on hover / focus. */
export function QualityFlags({ flags, className }: { flags: string[]; className?: string }) {
  if (!flags.length)
    return <span className="text-muted-foreground text-xs">No issues detected</span>;
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
