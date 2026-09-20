/**
 * The bar every screen on Standard's way ends with.
 *
 * Presentational and hook-free on purpose: the server renders it with a link, and the two screens
 * that must save before they move render it with a button. One shape, so the button a person is
 * looking for is in the same place on every screen of the path.
 */
export function GuidedFooter({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3" data-testid="guided-next">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}
