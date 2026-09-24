import { notFound } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { publicationWithEditions } from "@/server/outputs/service";
import { activeIdentity } from "@/server/design/identity";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { getUi } from "@/server/i18n/locale";
import { modelShelf } from "@/server/design/models/service";
import { ModelGallery } from "@/app/(newsroom)/editions/[editionId]/models/model-gallery";
import { BlueprintStudio } from "./blueprint-studio";

export const dynamic = "force-dynamic";

/**
 * The model a newsletter is made on.
 *
 * It belongs to the title rather than to an edition, because that is what it is: an edition is one
 * month and the model is what every month is poured into. Its own screen rather than a card in a
 * settings list, because the moment it matters is the moment somebody starts a newsletter and has
 * a file in their hand.
 */
export default async function BlueprintPage({ params }: { params: Promise<{ publicationId: string }> }) {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  if (!hasPermission(user, "layout:edit")) return <NoAccess title={tr("The model")} permission="layout:edit" />;
  const { publicationId } = await params;
  const data = await publicationWithEditions(publicationId, tenant.organizationId);
  if (!data) notFound();
  const [identity, shelf] = await Promise.all([activeIdentity(publicationId), modelShelf(publicationId)]);

  return (
    <>
      <PageHeader
        title={tr("The model")}
        description={`${data.publication.name} · ${tr("What every edition of this newsletter is made on.")}`}
        back={{ href: `/publications/${publicationId}`, label: data.publication.name }}
      />
      <PageBody className="mx-auto w-full max-w-5xl space-y-6">
        {/*
          * The shelf first, the two ways of making your own second.
          *
          * Somebody arriving here has one of two things: a newsletter they already publish, or
          * nothing but a logo. The second is much the commoner case and used to be answered with an
          * empty screen and a button marked "design one from my brand", which asks a person to
          * imagine the result before agreeing to it. Showing the models as pages answers it before
          * the question is asked.
          */}
        <section className="space-y-2">
          <SectionTitle>{tr("Choose a model")}</SectionTitle>
          <ModelGallery shelf={shelf} canAdopt />
        </section>

        <section className="space-y-2">
          <SectionTitle>{tr("Or make your own")}</SectionTitle>
          <BlueprintStudio
            publicationId={publicationId}
            publicationName={data.publication.name}
            current={
              identity.source
                ? {
                    kind: identity.source.kind,
                    fileName: identity.source.fileName,
                    summary: identity.source.summary,
                    at: identity.source.at,
                    rubrics: identity.rubrics.map((rubric) => rubric.name),
                  }
                : null
            }
            firstEditionId={data.editions[0]?.id ?? null}
          />
        </section>
      </PageBody>
    </>
  );
}
