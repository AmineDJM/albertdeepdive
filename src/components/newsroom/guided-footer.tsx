import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The bar every screen on Standard's way ends with.
 *
 * Presentational and hook-free on purpose: the server renders it with a link, and the two screens
 * that must save before they move render it with a button. One shape, so the button a person is
 * looking for is in the same place on every screen of the path.
 *
 * The way back belongs here too. A path with only a forward button is a path you can be pushed
 * along but not walked — and somebody on step two who wants to change what they said on step one
 * should not have to work out which link in the sidebar leads back to it.
 */
export function GuidedFooter({ title, hint, back, children }: { title: string; hint: string; back?: { href: string; label: string } | null; children: React.ReactNode }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3" data-testid="guided-next">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {back ? (
          <Button asChild variant="ghost" data-testid="guided-back-button">
            <Link href={back.href}>
              <ArrowLeft /> {back.label}
            </Link>
          </Button>
        ) : null}
        {children}
      </div>
    </section>
  );
}
