import Link from "next/link";
import { GalleryVerticalEnd } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { adminCollections, showcaseOverview } from "@/server/showcase/curation";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewCollection } from "./new-collection";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const percent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)}%`);

/**
 * The gallery, from the inside.
 *
 * Every collection with what it can actually show, which is rarely what it holds: an item whose
 * title has withdrawn consent stays in the list and stops being drawn. The two numbers that matter
 * are here rather than a page away, because a collection nobody opens and a collection everybody
 * signs up from should not look the same in a list.
 */
export default async function CollectionsPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <PageHeader title={tr("Collections")} />;
  const [collections, overview] = await Promise.all([adminCollections(), showcaseOverview()]);
  return (
    <>
      <PageHeader
        title={tr("Collections")}
        description={tr("The public gallery at /collections. Only a title whose owner agreed can appear, whatever a collection holds.")}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <a href="/collections" target="_blank" rel="noreferrer">{tr("Open the gallery")}</a>
            </Button>
            <NewCollection />
          </div>
        }
      />
      <PageBody className="space-y-6">
        <StatGrid>
          <Stat label={tr("Gallery views")} value={overview.galleryViews} hint={tr("the front page")} />
          <Stat label={tr("Collection views")} value={overview.collectionViews} />
          <Stat label={tr("Publications opened")} value={overview.opens} hint={tr("visitors reading a real edition")} hue="teal" />
          <Stat label={tr("Signup clicks")} value={overview.signupClicks} hint={`${percent(overview.clickThrough)} ${tr("of views")}`} hue="green" />
        </StatGrid>

        <DataTable
          rows={collections}
          rowKey={(c) => c.id}
          onRowHref={(c) => `/admin/collections/${c.id}`}
          empty={{ title: tr("No collections yet"), description: tr("A collection is a shelf: universities, startups, monthly reports. Make one, then add published editions to it."), icon: GalleryVerticalEnd }}
          columns={[
            {
              key: "title",
              header: tr("Collection"),
              cell: (c) => (
                <div>
                  <span className="flex items-center gap-2">
                    <Link href={`/admin/collections/${c.id}`} className="font-medium hover:underline">{c.title}</Link>
                    {c.isPublished ? <Badge variant="success">{tr("Live")}</Badge> : <Badge variant="muted">{tr("Draft")}</Badge>}
                    {c.isFeatured ? <Badge variant="outline">{tr("Featured")}</Badge> : null}
                  </span>
                  <div className="text-2xs text-muted-foreground">/collections/{c.slug}</div>
                </div>
              ),
            },
            { key: "category", header: tr("Category"), cell: (c) => <span className="text-xs text-muted-foreground">{c.category ?? "—"}</span> },
            {
              key: "items",
              header: tr("Showing"),
              cell: (c) => (
                <span className="tabular text-xs">
                  {c.showable} / {c.total}
                  {c.showable < c.total ? <span className="ml-1.5 text-warning">{tr("some hidden")}</span> : null}
                </span>
              ),
              align: "right",
            },
            { key: "views", header: tr("Views"), cell: (c) => <span className="tabular text-xs">{c.views}</span>, align: "right" },
            { key: "opens", header: tr("Opens"), cell: (c) => <span className="tabular text-xs">{c.opens}</span>, align: "right" },
            { key: "ctr", header: tr("To signup"), cell: (c) => <span className="tabular text-xs">{percent(c.clickThrough)}</span>, align: "right" },
          ]}
        />

        {overview.top.length ? (
          <section className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-2.5">
              <span className="label-caps">{tr("Most opened publications")}</span>
            </header>
            <ul className="divide-y divide-border">
              {overview.top.map((row) => (
                <li key={row.editionId} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]">
                  <span className="min-w-0 truncate">
                    {row.label} <span className="text-muted-foreground">· {row.organization ?? "—"}</span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-muted-foreground">{row.n}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </PageBody>
    </>
  );
}
