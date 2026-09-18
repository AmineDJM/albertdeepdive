"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GalleryControls, ItemCard, ShowcaseCta, useGallery } from "./gallery";
import { track } from "./track";
import { useUi } from "@/components/i18n/provider";
import type { GalleryItem } from "@/server/showcase/service";

/**
 * One collection: a masthead, then an editorial grid.
 *
 * The curator's order is the default order, and the featured item takes the wide cell — a gallery
 * where everything is the same size is a list, and a list is not an argument for anything.
 */
export function CollectionPage({
  collection,
  items,
  categoryLabels,
  languageLabels,
}: {
  collection: { id: string; title: string; tagline: string | null; description: string | null };
  items: GalleryItem[];
  categoryLabels: Record<string, string>;
  languageLabels: Record<string, string>;
}) {
  const tr = useUi();
  const gallery = useGallery(items);
  useEffect(() => track("COLLECTION_VIEW", { collectionId: collection.id }), [collection.id]);
  const label = (map: Record<string, string>) => (value: string) => map[value] ?? value;

  return (
    <div className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
      <header className="py-12 sm:py-16">
        <Link href="/collections" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-3.5" /> {tr("All collections")}
        </Link>
        <h1 className="masthead mt-4 max-w-3xl text-[34px] leading-[1.08] font-semibold tracking-tight sm:text-[46px]">{collection.title}</h1>
        {collection.tagline ? <p className="mt-3 max-w-2xl text-[16px] leading-7 text-muted-foreground">{collection.tagline}</p> : null}
        {collection.description ? <p className="mt-3 max-w-2xl text-[14px] leading-6 text-muted-foreground">{collection.description}</p> : null}
      </header>

      {items.length > 3 ? (
        <div className="mb-6">
          <GalleryControls
            query={gallery.query}
            onQuery={gallery.setQuery}
            order={gallery.order}
            onOrder={gallery.setOrder}
            categories={[]}
            category={gallery.category}
            onCategory={gallery.setCategory}
            languages={languagesOf(items)}
            language={gallery.language}
            onLanguage={gallery.setLanguage}
            categoryLabel={label(categoryLabels)}
            languageLabel={label(languageLabels)}
          />
        </div>
      ) : null}

      {gallery.shown.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gallery.shown.map((item) => (
            <ItemCard key={item.editionId} item={item} large={item.isFeatured} onOpen={(i) => track("ITEM_OPEN", { editionId: i.editionId, collectionId: collection.id })} />
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-[14px] text-muted-foreground">{tr("Nothing matches that. Try a broader search, or clear the filters.")}</p>
      )}

      <div className="mt-16">
        <ShowcaseCta onClick={() => track("SIGNUP_CLICK", { collectionId: collection.id })} />
      </div>
    </div>
  );
}

function languagesOf(items: GalleryItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.language, (counts.get(item.language) ?? 0) + 1);
  return [...counts.entries()].map(([value, count]) => ({ value, count }));
}
