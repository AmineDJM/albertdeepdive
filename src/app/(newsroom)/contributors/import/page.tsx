import { TriangleAlert } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listCampusesWithStats } from "@/server/contributors/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ImportWizard } from "@/components/contributors/import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportContributorsPage() {
  const user = await getCurrentUser();
  const canManage = hasPermission(user, "contributor:manage");
  const campuses = canManage ? await listCampusesWithStats() : [];
  return (
    <>
      <PageHeader
        title="Import contributors"
        description="Bring a whole cohort in from a spreadsheet, mapping its columns to the contributor fields."
        breadcrumbs={[{ label: "Contributors", href: "/contributors" }, { label: "Import" }]}
      />
      <PageBody className="mx-auto max-w-5xl">
        {canManage ? (
          <ImportWizard campusNames={campuses.map((c) => c.name)} />
        ) : (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertTitle>You cannot import contributors</AlertTitle>
            <AlertDescription>Importing contributors needs the “contributor:manage” permission. Ask an editor to run the import.</AlertDescription>
          </Alert>
        )}
      </PageBody>
    </>
  );
}
