import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicCollection } from "@/server/showcase/service";
import { CollectionPage } from "@/components/showcase/collection-page";
import { categoryLabels, languageLabels } from "@/server/showcase/labels";
import { getUi } from "@/server/i18n/locale";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await publicCollection(slug);
  if (!loaded) return { title: "Not found" };
  const title = loaded.collection.seoTitle || loaded.collection.title;
  const description = loaded.collection.seoDescription || loaded.collection.tagline || loaded.collection.description || undefined;
  return {
    title: { absolute: title },
    description,
    metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
    alternates: { canonical: `/collections/${slug}` },
    openGraph: { title, description, type: "website", url: `/collections/${slug}`, images: loaded.collection.coverUrl ? [loaded.collection.coverUrl] : undefined },
    robots: { index: true, follow: true },
  };
}

export default async function OneCollection({ params }: { params: Promise<{ slug: string }> }) {
  const tr = await getUi();
  const { slug } = await params;
  const loaded = await publicCollection(slug);
  // A collection with nothing it may show is not a page: it is a promise we cannot keep.
  if (!loaded || !loaded.items.length) notFound();
  return (
    <CollectionPage
      collection={{ id: loaded.collection.id, title: loaded.collection.title, tagline: loaded.collection.tagline, description: loaded.collection.description }}
      items={loaded.items}
      categoryLabels={categoryLabels(tr)}
      languageLabels={languageLabels(tr)}
    />
  );
}
