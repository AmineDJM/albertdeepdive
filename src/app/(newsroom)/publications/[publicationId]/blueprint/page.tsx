import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { publicationWithEditions } from "@/server/outputs/service";
import { activeIdentity } from "@/server/design/identity";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { getUi } from "@/server/i18n/locale";
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
  const identity = await activeIdentity(publicationId);

  return (
    <>
      <PageHeader
        title={tr("The model")}
        description={`${data.publication.name} · ${tr("What every edition of this newsletter is made on.")}`}
        actions={
          <Link href={`/publications/${publicationId}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline">
            <ArrowLeft className="size-3.5" /> {tr("Back to the newsletter")}
          </Link>
        }
      />
      <PageBody className="mx-auto w-full max-w-3xl">
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
      </PageBody>
    </>
  );
}
