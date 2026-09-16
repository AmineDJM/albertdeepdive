import { cn } from "@/lib/utils";

/** A small A4-proportioned preview of the issue: cover photo with masthead overlay, or a typographic placeholder. */
export function CoverThumbnail({ url, label, issueLabel, headline, className }: { url: string | null; label: string; issueLabel: string; headline?: string | null; className?: string }) {
  return (
    <div className={cn("relative aspect-[210/297] w-full overflow-hidden rounded-sm border border-border bg-[oklch(0.22_0.05_262)] shadow-md", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="absolute inset-0 size-full object-cover opacity-90" />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-b from-[oklch(0.2_0.05_262/0.85)] via-transparent to-[oklch(0.15_0.04_262/0.9)]" />
      <div className="absolute inset-x-0 top-0 p-2.5 text-white">
        <div className="masthead text-[13px] leading-none font-semibold">Albert&rsquo;s Deep Dive</div>
        <div className="mt-1 text-[8px] uppercase tracking-[0.12em] text-white/70">
          {issueLabel} · {label}
        </div>
      </div>
      {headline ? <div className="absolute inset-x-0 bottom-0 p-2.5 font-display text-[10px] leading-[1.15] font-semibold text-white line-clamp-4">{headline}</div> : null}
    </div>
  );
}
