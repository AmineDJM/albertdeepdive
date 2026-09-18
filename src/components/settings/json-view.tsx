import { cn } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

/** Pretty-printed JSON in a scrollable monospace block. */
export async function JsonView({ value, className, maxHeight = 320 }: { value: unknown; className?: string; maxHeight?: number }) {
  const tr = await getUi();
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  if (text === undefined || text === "undefined" || text === "null" || text === "{}" || text === "[]") {
    return <div className={cn("rounded-md border border-dashed border-border px-3 py-2 text-2xs text-muted-foreground", className)}>{tr("Empty")}</div>;
  }
  return (
    <pre className={cn("overflow-auto rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[11.5px] leading-[1.5] whitespace-pre-wrap break-words text-foreground scrollbar-thin", className)} style={{ maxHeight }}>
      {text}
    </pre>
  );
}
