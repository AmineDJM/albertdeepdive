import Link from "next/link";
import { Suspense } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { audienceFacets, listRecipients } from "@/server/audience/service";
import { listCampusesWithStats } from "@/server/contributors/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { AUDIENCE_TABS } from "@/components/newsroom/nav";
import { FilterBar } from "@/components/newsroom/filter-bar";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { NoAccess } from "@/components/settings/no-access";
import { RecipientEditor } from "@/components/directory/recipient-editor";
import { RecipientsTable } from "@/components/directory/recipients-table";
import { AUDIENCE_SEGMENTS } from "@/lib/constants";
import { enumLabel } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const tr = await getUi();
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!hasPermission(user, "contributor:manage")) return <NoAccess title={tr("Directory")} permission="contributor:manage" />;
  const [rows, campuses, facets] = await Promise.all([
    listRecipients({ q: sp.q, segment: sp.segment, campusId: sp.campusId, active: sp.active as "true" | "false" | undefined }),
    listCampusesWithStats(),
    audienceFacets(),
  ]);
  const campusOptions = campuses.map((c) => ({ id: c.id, name: c.name }));
  return (
    <>
      <PageHeader
        title={tr("Directory")}
        description={tr("Who the finished magazine is sent to — the audience, kept separate from contributors.")}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/directory/import"><Upload />{" "}{tr("Import from a file")}</Link></Button>
            <Suspense><RecipientEditor campuses={campusOptions} openOnParam /></Suspense>
          </div>
        }
      >
        <HubTabs tabs={AUDIENCE_TABS} />
      </PageHeader>
      <PageBody className="space-y-4">
        <StatGrid columns={4}>
          <Stat label={tr("Recipients")} value={facets.total} hint={`${facets.active} active`} />
          <Stat label={tr("Active")} value={facets.active} hint={`${facets.inactive} inactive`} />
          <Stat label={tr("Partners")} value={facets.bySegment.PARTNER} hint={tr("partner contacts")} />
          <Stat label={tr("Parents")} value={facets.bySegment.PARENT} hint={tr("parent contacts")} />
        </StatGrid>
        <Suspense>
          <FilterBar
            searchPlaceholder={tr("Search name, email, organisation…")}
            filters={[
              { key: "segment", label: tr("Segment"), options: AUDIENCE_SEGMENTS.map((seg) => ({ value: seg, label: enumLabel(seg) })) },
              { key: "campusId", label: tr("Campus"), options: [...campuses.map((c) => ({ value: c.id, label: c.name })), { value: "school", label: tr("School-wide") }] },
              { key: "active", label: tr("Status"), options: [{ value: "true", label: tr("Active") }, { value: "false", label: tr("Inactive") }], allLabel: tr("Active & inactive") },
            ]}
          />
        </Suspense>
        <RecipientsTable rows={rows} campuses={campusOptions} />
      </PageBody>
    </>
  );
}
