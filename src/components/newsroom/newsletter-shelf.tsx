import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { NewEditionButton } from "@/components/newsroom/new-edition-button";
import { standingOf } from "@/lib/editorial/edition-steps";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import type { newsletterShelf } from "@/server/outputs/service";

export type Shelf = Awaited<ReturnType<typeof newsletterShelf>>;

/**
 * The newsletters, each with the edition being made.
 *
 * A person does not have "editions". They have a newsletter — one thing, set up once, that runs
 * for years — and every month it produces the next one. Leading with a flat list of editions
 * asked them to hold the shelf in their head; this puts the shelf on the screen, and each title
 * says where its current edition has got to in the same words the edition's own header uses.
 *
 * A title with nothing in progress is not a gap to apologise for: it is exactly the moment to
 * start the next one, so that is the button it carries.
 */
export function NewsletterShelf({
  shelf,
  canCreate,
  newNewsletter,
  tr,
}: {
  shelf: Shelf;
  canCreate: boolean;
  /** The "New newsletter" control, which is a dialog and therefore a client component. */
  newNewsletter?: React.ReactNode;
  tr: (text: string, values?: Record<string, string | number>) => string;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {shelf.map((title) => (
        <article key={title.id} className="lift flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/publications/${title.id}`} className="block truncate text-[15px] font-semibold hover:underline">
                {title.name}
              </Link>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {title.editions === 1 ? tr("1 edition") : tr("{count} editions", { count: title.editions })}
                {title.published ? ` · ${title.published === 1 ? tr("1 published") : tr("{count} published", { count: title.published })}` : ""}
              </p>
            </div>
            {title.live ? <EditionStatusBadge status={title.live.status} /> : null}
          </div>

          {title.live ? (
            <Link href={`/editions/${title.live.id}`} className="group rounded-lg border border-border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/60">
              <p className="truncate text-[13px] font-medium">
                {tr("Edition")} #{title.live.issueNumber} <span className="font-normal text-muted-foreground">· {title.live.label}</span>
              </p>
              <p className="mt-0.5 flex items-center gap-1 text-2xs text-muted-foreground">
                {tr(standingOf(title.live.status as EditionStatus))}
                <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
            </Link>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-3 py-2 text-[13px] text-muted-foreground">{tr("Nothing in progress")}</p>
          )}

          {canCreate ? (
            <div className="mt-auto">
              <NewEditionButton variant="outline" size="sm" label={title.live ? tr("New edition") : tr("Start the next edition")} />
            </div>
          ) : null}
        </article>
      ))}

      {canCreate && newNewsletter ? (
        <article className="flex flex-col items-start justify-center gap-2 rounded-xl border border-dashed border-border p-4">
          <p className="text-[13px] font-medium">{tr("Start another newsletter")}</p>
          <p className="text-xs text-muted-foreground">{tr("A second title — a weekly for one audience, a quarterly for another. Its first edition is created with it.")}</p>
          <div className="mt-1">{newNewsletter}</div>
        </article>
      ) : null}
    </div>
  );
}

/** The empty case: no newsletter yet, and one thing to do about it. */
export function NoNewsletters({ newNewsletter, tr }: { newNewsletter: React.ReactNode; tr: (text: string) => string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-center">
      <Plus className="mx-auto size-5 text-muted-foreground" />
      <p className="mt-2 text-[15px] font-semibold">{tr("Start your first newsletter")}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        {tr("Name it once. Briefly creates its first edition straight away, and every month after that you only start the next one.")}
      </p>
      <div className="mt-4 flex justify-center">{newNewsletter}</div>
    </div>
  );
}
