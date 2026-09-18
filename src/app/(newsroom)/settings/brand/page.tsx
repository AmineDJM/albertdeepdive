import { requireTenant } from "@/server/tenancy/context";
import { getOrganization } from "@/server/tenancy/service";
import { ensureBrand } from "@/server/brand/service";
import { compileBrandSystem } from "@/lib/brand/system";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { BrandEditor } from "./brand-editor";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Brand DNA.
 *
 * The one place an organisation's identity is decided, and the input to every renderer Briefly has.
 * Most of it arrived from the customer's own website during onboarding, so the job of this screen is
 * less "fill in a form" than "check what we found and change what is wrong".
 */
export default async function BrandSettingsPage() {
  const tr = await getUi();
  const tenant = await requireTenant();
  const [organization, record] = await Promise.all([getOrganization(tenant.organizationId), ensureBrand(tenant.organizationId)]);
  const canEdit = tenant.role === "OWNER" || tenant.role === "ADMIN";
  const tokens = compileBrandSystem(record.system);

  return (
    <>
      <PageHeader title={tr("Brand")} description={tr("Your colours, your type and your voice — used by every edition, email, page and export.")} />
      <PageBody>
        <BrandEditor
          canEdit={canEdit}
          organizationName={organization.name}
          initial={record.system}
          initialTokens={tokens}
          origin={record.origin}
          notes={record.notes}
          website={organization.website ?? ""}
        />
      </PageBody>
    </>
  );
}
