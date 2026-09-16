import { formatDateTime } from "@/lib/utils";
import type { MediaAuditEntry } from "@/server/media/library";
import { MEDIA_AUDIT_LABELS } from "@/server/media/constants";

function details(entry: MediaAuditEntry) {
  const m = entry.metadata;
  const parts: string[] = [];
  if (typeof m.reason === "string" && m.reason) parts.push(`“${m.reason}”`);
  if (typeof m.storyTitle === "string") parts.push(m.storyTitle);
  if (typeof m.role === "string") parts.push(`role ${m.role}`);
  if (Array.isArray(m.fields)) parts.push((m.fields as string[]).join(", "));
  if (typeof m.name === "string" && typeof m.aspect === "string")
    parts.push(`${m.name} ${m.aspect}`);
  if (typeof m.originalFileName === "string") parts.push(`of ${m.originalFileName}`);
  if (typeof m.textVersion === "string") parts.push(`text v${m.textVersion}`);
  if (typeof m.fileName === "string" && entry.action === "media.upload") parts.push(m.fileName);
  return parts.join(" · ");
}

export function AuditTrail({ entries }: { entries: MediaAuditEntry[] }) {
  if (!entries.length)
    return <p className="text-muted-foreground text-xs">No action recorded on this asset yet.</p>;
  return (
    <ol className="border-border bg-card divide-y rounded-lg border">
      {entries.map((e) => (
        <li key={e.id} className="flex items-baseline gap-3 px-3 py-2 text-xs">
          <span className="tabular text-muted-foreground w-28 shrink-0">
            {formatDateTime(e.createdAt)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-medium">{MEDIA_AUDIT_LABELS[e.action] ?? e.action}</span>
            {details(e) ? <span className="text-muted-foreground"> — {details(e)}</span> : null}
          </span>
          <span className="text-muted-foreground shrink-0">
            {e.userName ?? (e.actorType === "USER" ? "Unknown user" : e.actorType.toLowerCase())}
          </span>
        </li>
      ))}
    </ol>
  );
}
