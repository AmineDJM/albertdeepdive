import { Info } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getSystemSettings } from "@/server/settings/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { NoAccess } from "@/components/settings/no-access";
import { formatDateTime } from "@/lib/utils";
import { DefaultSectionsEditor } from "./default-sections-editor";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function SectionsSettingsPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "section:manage")) return <NoAccess title={tr("Sections")} permission="section:manage" />;
  const settings = await getSystemSettings();
  const meta = settings.meta.default_sections;
  return (
    <>
      <PageHeader title={tr("Sections")} description={tr("The section template every new edition starts from.")} meta={meta ? <span className="text-2xs text-muted-foreground">{tr("saved")}{" "}{formatDateTime(meta.updatedAt)}{meta.updatedBy ? ` by ${meta.updatedBy}` : ""}</span> : null} />
      <PageBody className="max-w-5xl space-y-4">
        <Alert variant="info">
          <Info />
          <AlertTitle>{tr("Editions copy this template when they are created")}</AlertTitle>
          <AlertDescription>
            <p>{tr("Changing it here does not touch existing editions — edit those in the edition’s own Settings tab. Slugs are stable identifiers used by the AI classifier and the flatplan; names, kickers, colours and page targets are free to change. Drag to reorder.")}</p>
          </AlertDescription>
        </Alert>
        <DefaultSectionsEditor key={meta?.updatedAt?.toISOString() ?? "initial"} sections={settings.defaultSections} />
      </PageBody>
    </>
  );
}
