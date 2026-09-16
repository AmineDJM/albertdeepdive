import { Check } from "lucide-react";
import { PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, roleHasPermission } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";

const GROUP_LABELS: Record<string, string> = {
  edition: "Editions",
  campaign: "Campaigns",
  submission: "Submissions",
  story: "Stories",
  article: "Articles",
  media: "Media",
  layout: "Layout",
  export: "Exports",
  qa: "Quality gates",
  ai: "AI",
  contributor: "Contributors",
  campus: "Campuses",
  section: "Sections",
  prompt: "Prompts",
  automation: "Automations",
  settings: "Settings",
  user: "Users",
  analytics: "Analytics",
  archive: "Archive",
  audit: "Audit",
};

/** Read-only roles × permissions grid, derived from src/lib/auth/permissions.ts. */
export function PermissionsMatrix() {
  const groups = new Map<string, string[]>();
  for (const p of PERMISSIONS) {
    const [group] = p.split(":");
    groups.set(group, [...(groups.get(group) ?? []), p]);
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-border">
            <th className="sticky left-0 bg-card px-3 py-2 text-left text-2xs font-medium tracking-[0.06em] text-muted-foreground uppercase">Permission</th>
            {ROLES.map((r) => (
              <th key={r} className="px-2 py-2 text-center text-2xs font-medium tracking-[0.06em] text-muted-foreground uppercase whitespace-nowrap" title={ROLE_DESCRIPTIONS[r]}>
                {ROLE_LABELS[r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...groups.entries()].map(([group, perms]) => (
            <GroupRows key={group} label={GROUP_LABELS[group] ?? group} perms={perms} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupRows({ label, perms }: { label: string; perms: string[] }) {
  return (
    <>
      <tr className="border-b border-border/60 bg-muted/30">
        <td colSpan={ROLES.length + 1} className="sticky left-0 px-3 py-1 text-2xs font-semibold text-muted-foreground">
          {label}
        </td>
      </tr>
      {perms.map((p) => (
        <tr key={p} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
          <td className="sticky left-0 bg-card px-3 py-1 font-mono text-xs">{p}</td>
          {ROLES.map((r) => {
            const has = roleHasPermission(r, p as (typeof PERMISSIONS)[number]);
            return (
              <td key={r} className={cn("px-2 py-1 text-center", has ? "text-success" : "text-muted-foreground/40")} aria-label={`${ROLE_LABELS[r]} ${has ? "can" : "cannot"} ${p}`}>
                {has ? <Check className="mx-auto size-3.5" /> : <span aria-hidden>·</span>}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
