import { notFound } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { adminCollection } from "@/server/showcase/curation";
import { consentingPublications } from "@/server/showcase/consent";
import { showableEditions } from "@/server/showcase/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { CollectionEditor } from "./collection-editor";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * One collection, edited.
 *
 * Three panels: what the collection says about itself, what is in it, and what may be added. The
 * third is the important one — it lists only editions that already pass the consent test, so a
 * curator physically cannot add somebody's private work, and the titles that have not agreed are
 * shown separately with their consent state rather than hidden, because "why is this customer not
 * in the picker" is the question the console should answer.
 */
export default async function CollectionEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const tr = await getUi();
  const { id } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) return <PageHeader title={tr("Collections")} />;
  const loaded = await adminCollection(id);
  if (!loaded) notFound();
  const [candidates, publications] = await Promise.all([showableEditions({ limit: 300 }), consentingPublications()]);
  const inside = new Set(loaded.items.map((item) => item.editionId));
  return (
    <>
      <PageHeader title={loaded.collection.title} description={`/collections/${loaded.collection.slug}`} />
      <PageBody>
        <CollectionEditor
          collection={{
            id: loaded.collection.id,
            slug: loaded.collection.slug,
            title: loaded.collection.title,
            tagline: loaded.collection.tagline,
            description: loaded.collection.description,
            category: loaded.collection.category,
            language: loaded.collection.language,
            tags: loaded.collection.tags,
            coverUrl: loaded.collection.coverUrl,
            isPublished: loaded.collection.isPublished,
            isFeatured: loaded.collection.isFeatured,
            pinnedOrder: loaded.collection.pinnedOrder,
            sortOrder: loaded.collection.sortOrder,
            seoTitle: loaded.collection.seoTitle,
            seoDescription: loaded.collection.seoDescription,
          }}
          items={loaded.items.map((item) => ({
            editionId: item.editionId,
            label: item.label,
            title: item.title,
            organization: item.organization,
            publication: item.publication,
            blurb: item.blurb,
            isFeatured: item.isFeatured,
            showing: item.showing,
            why: item.why,
            coverUrl: item.coverUrl,
            href: item.href,
          }))}
          candidates={candidates
            .filter((candidate) => !inside.has(candidate.editionId))
            .map((candidate) => ({ editionId: candidate.editionId, label: candidate.label, title: candidate.title, organization: candidate.organization, coverUrl: candidate.coverUrl }))}
          publications={publications.map((publication) => ({
            id: publication.id,
            name: publication.name,
            organization: publication.organization,
            consent: publication.consent,
            note: publication.note,
            isDemo: publication.isDemo,
          }))}
        />
      </PageBody>
    </>
  );
}
