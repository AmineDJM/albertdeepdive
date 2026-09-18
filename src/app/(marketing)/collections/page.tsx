import type { Metadata } from "next";
import { publicCollections, showableEditions } from "@/server/showcase/service";
import { GalleryPage } from "@/components/showcase/gallery-page";
import { categoryLabels, languageLabels } from "@/server/showcase/labels";
import { getUi } from "@/server/i18n/locale";
import { env } from "@/server/env";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * The gallery.
 *
 * It is a marketing surface, so it is indexable and fast to read; it is also other people's work,
 * so everything on it passed the consent test in `showableEditions` before it got here.
 */
export async function generateMetadata(): Promise<Metadata> {
  const title = `Collections — real publications made with ${BRAND.name}`;
  const description = "A curated gallery of newsletters, magazines and reports published by universities, startups, communities and companies with Briefly.";
  return {
    title: { absolute: title },
    description,
    metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
    alternates: { canonical: "/collections" },
    openGraph: { title, description, type: "website", url: "/collections" },
    robots: { index: true, follow: true },
  };
}

export default async function CollectionsIndex() {
  const tr = await getUi();
  const [collections, items] = await Promise.all([publicCollections(), showableEditions({ limit: 120 })]);
  return <GalleryPage collections={collections} items={items} categoryLabels={categoryLabels(tr)} languageLabels={languageLabels(tr)} />;
}
