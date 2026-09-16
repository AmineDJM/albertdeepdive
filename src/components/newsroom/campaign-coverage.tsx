import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProgressBar } from "./stat";

export type CoverageRow = {
  key: string;
  name: string;
  colour: string | null;
  target: number;
  pool: number;
  invited: number;
  submitted: number;
  declined: number;
  silent: number;
  submissions: number;
  responseRate: number;
};

function rateTone(rate: number, invited: number) {
  if (!invited) return "muted" as const;
  if (rate >= 0.6) return "success" as const;
  if (rate >= 0.3) return "brand" as const;
  return "warning" as const;
}

/** Per-campus coverage of the campaign: who was invited, who answered, who is still silent. */
export function CampaignCoverage({ rows, balanceLabel }: { rows: CoverageRow[]; balanceLabel?: "Balanced" | "Uneven" | "Critical" }) {
  const totals = rows.reduce(
    (acc, r) => ({
      target: acc.target + r.target,
      invited: acc.invited + r.invited,
      submitted: acc.submitted + r.submitted,
      silent: acc.silent + r.silent,
      submissions: acc.submissions + r.submissions,
    }),
    { target: 0, invited: 0, submitted: 0, silent: 0, submissions: 0 },
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Campus</TableHead>
            <TableHead className="text-right">Target</TableHead>
            <TableHead className="text-right">Pool</TableHead>
            <TableHead className="text-right">Invited</TableHead>
            <TableHead className="text-right">Submitted</TableHead>
            <TableHead className="text-right">Silent</TableHead>
            <TableHead className="w-[180px]">Response rate</TableHead>
            <TableHead className="text-right">Submissions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key}>
              <TableCell className="py-1.5">
                <span className="flex items-center gap-2 font-medium">
                  <span className="size-2 rounded-full" style={{ backgroundColor: r.colour ?? "#94a3b8" }} />
                  {r.name}
                </span>
              </TableCell>
              <TableCell className="tabular py-1.5 text-right text-muted-foreground">{r.target || "—"}</TableCell>
              <TableCell className="tabular py-1.5 text-right text-muted-foreground">{r.pool || "—"}</TableCell>
              <TableCell className="tabular py-1.5 text-right">
                {r.invited}
                {r.target > r.invited ? <span className="ml-1 text-2xs text-warning">-{r.target - r.invited}</span> : null}
              </TableCell>
              <TableCell className="tabular py-1.5 text-right font-medium">{r.submitted}</TableCell>
              <TableCell className="tabular py-1.5 text-right">
                {r.silent ? <span className={r.invited && r.silent === r.invited ? "text-warning" : undefined}>{r.silent}</span> : "—"}
                {r.declined ? <span className="ml-1 text-2xs text-muted-foreground">{r.declined} declined</span> : null}
              </TableCell>
              <TableCell className="py-1.5">
                <div className="flex items-center gap-2">
                  <ProgressBar value={r.submitted} max={Math.max(1, r.invited)} tone={rateTone(r.responseRate, r.invited)} className="w-24" />
                  <span className="tabular text-2xs text-muted-foreground">{r.invited ? `${Math.round(r.responseRate * 100)}%` : "—"}</span>
                </div>
              </TableCell>
              <TableCell className="tabular py-1.5 text-right">{r.submissions || "—"}</TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 border-border bg-muted/30 hover:bg-muted/30">
            <TableCell className="py-1.5 font-medium">
              All campuses
              {balanceLabel ? (
                <Badge
                  variant={balanceLabel === "Balanced" ? "success" : balanceLabel === "Uneven" ? "warning" : "destructive"}
                  className="ml-2"
                  title="How evenly the submissions of this edition are spread across campuses"
                >
                  Balance: {balanceLabel}
                </Badge>
              ) : null}
            </TableCell>
            <TableCell className="tabular py-1.5 text-right text-muted-foreground">{totals.target}</TableCell>
            <TableCell className="py-1.5" />
            <TableCell className="tabular py-1.5 text-right font-medium">{totals.invited}</TableCell>
            <TableCell className="tabular py-1.5 text-right font-medium">{totals.submitted}</TableCell>
            <TableCell className="tabular py-1.5 text-right">{totals.silent}</TableCell>
            <TableCell className="py-1.5">
              <div className="flex items-center gap-2">
                <ProgressBar value={totals.submitted} max={Math.max(1, totals.invited)} tone="brand" className="w-24" />
                <span className="tabular text-2xs text-muted-foreground">{totals.invited ? `${Math.round((totals.submitted / totals.invited) * 100)}%` : "—"}</span>
              </div>
            </TableCell>
            <TableCell className="tabular py-1.5 text-right font-medium">{totals.submissions}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
