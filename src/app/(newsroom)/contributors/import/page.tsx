import { TriangleAlert } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listCampusesWithStats } from "@/server/contributors/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ImportWizard } from "@/components/contributors/import-wizard";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function ImportContributorsPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  const canManage = hasPermission(user, "contributor:manage");
  const campuses = canManage ? await listCampusesWithStats() : [];
  return (
    <>
      <PageHeader
        title={tr("Import contributors")}
        description={tr("Bring a whole cohort in from a spreadsheet, mapping its columns to the contributor fields.")}
        breadcrumbs={[{ label: tr("Contributors"), href: "/contributors" }, { label: tr("Import") }]}
      />
      <PageBody className="mx-auto max-w-5xl">
        {canManage ? (
          <ImportWizard campusNames={campuses.map((c) => c.name)} />
        ) : (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertTitle>{tr("You cannot import contributors")}</AlertTitle>
            <AlertDescription>{tr("Importing contributors needs the “contributor:manage” permission. Ask an editor to run the import.")}</AlertDescription>
          </Alert>
        )}
      </PageBody>
    </>
  );
}
