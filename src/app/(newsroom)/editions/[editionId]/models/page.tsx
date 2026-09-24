import Link from "next/link";
import { Shapes } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getEdition } from "@/server/editions/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { modelShelf } from "@/server/design/models/service";
import { getUi } from "@/server/i18n/locale";
import { ModelGallery } from "./model-gallery";

export const dynamic = "force-dynamic";

/**
 * What this newsletter will look like, before there is one.
 *
 * Reached from the edition, because that is where the question comes up: somebody has just made an
 * issue, there is nothing in it yet, and the preview they reached for has nothing to show them.
 * The honest answer is not an empty page — it is the shelf of models the issue will be poured into
 * once the writing arrives.
 *
 * The models belong to the *title*, not to this issue, which is why adopting one here changes
 * every edition of it. The screen says so rather than letting somebody discover it next month.
 */
export default async function EditionModelsPage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "edition:view")) return <NoAccess title={tr("The models")} permission="edition:view" />;

  const edition = await getEdition(editionId);
  const ed = `/editions/${editionId}`;

  if (!edition.publicationId) {
    return (
      <>
        <PageHeader title={tr("The models")} description={edition.label} />
        <PageBody className="mx-auto w-full max-w-5xl">
          <EmptyState
            icon={Shapes}
            title={tr("This edition is not part of a newsletter yet")}
            description={tr("A model belongs to a newsletter, so that every edition of it looks like the same publication. Put this edition under a newsletter first.")}
            action={<Button asChild size="sm" variant="outline"><Link href={ed}>{tr("Back to the edition")}</Link></Button>}
          />
        </PageBody>
      </>
    );
  }

  const shelf = await modelShelf(edition.publicationId);
  const canAdopt = hasPermission(user, "layout:edit");

  return (
    <>
      <PageHeader
        title={tr("The models")}
        description={`${shelf.publicationName} · ${tr("What your newsletter is poured into. Choosing one changes every edition of this newsletter, not just this one.")}`}
        back={{ href: ed, label: tr("Back to the edition") }}
      />
      <PageBody className="mx-auto w-full max-w-5xl space-y-4">
        <ModelGallery shelf={shelf} canAdopt={canAdopt} />
        <p className="text-2xs text-muted-foreground">
          {tr("Have a newsletter of your own already? Briefly can read its look out of a PDF, a Word file or a picture of a page.")}{" "}
          <Link href={`/publications/${shelf.publicationId}/blueprint`} className="underline hover:text-foreground">
            {tr("Use a newsletter I already have")}
          </Link>
        </p>
      </PageBody>
    </>
  );
}
