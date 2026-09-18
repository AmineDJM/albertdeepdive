"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CollectionTile, GalleryControls, ItemCard, ShowcaseCta, useGallery } from "./gallery";
import { track } from "./track";
import { useUi } from "@/components/i18n/provider";
import type { CollectionCard, GalleryItem } from "@/server/showcase/service";

/**
 * The gallery's front page.
 *
 * Collections first, because a visitor who recognises their own kind of organisation will click it
 * before reading anything; then every publication, filterable, for the visitor who would rather
 * browse. One call to action at the end, not three on the way down.
 */
export function GalleryPage({ collections, items, categoryLabels, languageLabels }: { collections: CollectionCard[]; items: GalleryItem[]; categoryLabels: Record<string, string>; languageLabels: Record<string, string> }) {
  const tr = useUi();
  const gallery = useGallery(items);
  useEffect(() => track("GALLERY_VIEW"), []);
  const featured = collections.filter((c) => c.isFeatured).sort((a, b) => (a.pinnedOrder ?? 99) - (b.pinnedOrder ?? 99));
  const rest = collections.filter((c) => !c.isFeatured);
  const label = (map: Record<string, string>) => (value: string) => map[value] ?? value;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
      <header className="py-14 sm:py-20">
        <p className="label-caps text-brand">{tr("The gallery")}</p>
        <h1 className="masthead mt-3 max-w-3xl text-[36px] leading-[1.05] font-semibold tracking-tight sm:text-[52px]">{tr("Real publications, made by real organizations.")}</h1>
        <p className="mt-4 max-w-2xl text-[16px] leading-7 text-muted-foreground">
          {tr("Every edition here went out to actual readers. Open any of them and you are looking at what Briefly makes from what an organization already has to say.")}
        </p>
      </header>

      {featured.length ? (
        <section className="mb-14">
          <h2 className="masthead mb-4 text-[20px] font-semibold tracking-tight">{tr("Featured collections")}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((collection) => (
              <CollectionTile key={collection.id} collection={collection} onOpen={() => track("COLLECTION_VIEW", { collectionId: collection.id })} />
            ))}
          </div>
        </section>
      ) : null}

      {rest.length ? (
        <section className="mb-14">
          <h2 className="masthead mb-4 text-[20px] font-semibold tracking-tight">{tr("Browse by kind")}</h2>
          <div className="flex flex-wrap gap-2">
            {rest.map((collection) => (
              <Link
                key={collection.id}
                href={`/collections/${collection.slug}`}
                onClick={() => track("COLLECTION_VIEW", { collectionId: collection.id })}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[14px] transition-colors duration-150 hover:border-foreground/30"
              >
                {collection.title}
                <span className="tabular text-2xs text-muted-foreground">{collection.count}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mb-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <h2 className="masthead text-[20px] font-semibold tracking-tight">{tr("Every publication")}</h2>
          <p className="text-xs text-muted-foreground">
            {gallery.shown.length === 1 ? tr("1 publication") : tr("{count} publications", { count: gallery.shown.length })}
          </p>
        </div>
        <GalleryControls
          query={gallery.query}
          onQuery={gallery.setQuery}
          order={gallery.order}
          onOrder={gallery.setOrder}
          categories={facets(items, "category")}
          category={gallery.category}
          onCategory={gallery.setCategory}
          languages={facets(items, "language")}
          language={gallery.language}
          onLanguage={gallery.setLanguage}
          categoryLabel={label(categoryLabels)}
          languageLabel={label(languageLabels)}
        />
        {gallery.shown.length ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.shown.map((item) => (
              <ItemCard key={item.editionId} item={item} onOpen={(i) => track("ITEM_OPEN", { editionId: i.editionId })} />
            ))}
          </div>
        ) : (
          <p className="mt-10 text-center text-[14px] text-muted-foreground">{tr("Nothing matches that. Try a broader search, or clear the filters.")}</p>
        )}
      </section>

      <ShowcaseCta onClick={() => track("SIGNUP_CLICK")} />
    </div>
  );
}

function facets(items: GalleryItem[], key: "category" | "language") {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = item[key];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
