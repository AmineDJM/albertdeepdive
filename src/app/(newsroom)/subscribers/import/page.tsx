import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { SubscriberImportWizard } from "@/components/subscribers/import-wizard";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/** A spreadsheet of readers, with its columns matched by hand before anything is written. */
export default async function ImportSubscribersPage() {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  if (!hasPermission(user, "contributor:manage")) return <NoAccess title={tr("Import readers")} permission="contributor:manage" />;
  const titles = await db
    .select({ id: s.publications.id, name: s.publications.name })
    .from(s.publications)
    .where(and(eq(s.publications.organizationId, tenant.organizationId), eq(s.publications.isPublic, true)));

  return (
    <>
      <PageHeader
        title={tr("Import readers")}
        description={tr("Bring a list in from a spreadsheet, matching its columns yourself and seeing what will happen before it does.")}
        breadcrumbs={[{ label: tr("Subscribers"), href: "/subscribers" }, { label: tr("Import") }]}
      />
      <PageBody className="mx-auto w-full max-w-4xl">
        <SubscriberImportWizard titles={titles} />
      </PageBody>
    </>
  );
}
