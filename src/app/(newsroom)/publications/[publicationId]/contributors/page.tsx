import { Suspense } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { listCampusesWithStats, listContributors, listGroups, listPrograms } from "@/server/contributors/service";
import { PageBody } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { ShareLinks } from "@/components/newsroom/share-links";
import { NoAccess } from "@/components/settings/no-access";
import { formatDate } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";
import { ContributorEditor } from "@/app/(newsroom)/contributors/contributor-editor";
import { hubPublication, NewsletterHubHeader } from "../newsletter-hub";
import { AddExistingContributors, DetachContributor } from "./people-controls";

export const dynamic = "force-dynamic";

/**
 * The people who write for this newsletter.
 *
 * Its own list, apart from its readers and apart from the other newsletters': who gets asked when
 * an edition of this newsletter is made, and how they have answered. New people added here write
 * for it; people the organisation already knows are one click away.
 */
export default async function NewsletterContributorsPage({ params }: { params: Promise<{ publicationId: string }> }) {
  const tr = await getUi();
  const { publicationId } = await params;
  const [publication, user] = await Promise.all([hubPublication(publicationId), getCurrentUser()]);
  if (!hasPermission(user, "contributor:manage")) return <NoAccess title={tr("Contributors")} permission="contributor:manage" />;
  const [rows, everyone, groups, campuses, programs] = await Promise.all([
    listContributors({ publicationId: publication.id, active: "true" }),
    listContributors({ active: "true" }),
    listGroups(),
    listCampusesWithStats(),
    listPrograms(),
  ]);
  const onList = new Set(rows.map((row) => row.id));
  const others = everyone.filter((person) => !onList.has(person.id)).map((person) => ({ id: person.id, name: `${person.firstName} ${person.lastName}`.trim(), email: person.email }));
  const answered = rows.filter((row) => row.submissionsCount > 0).length;

  return (
    <>
      <NewsletterHubHeader
        publication={publication}
        description={tr("The people who write for this newsletter, and how they answer.")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AddExistingContributors publicationId={publication.id} people={others} />
            <Suspense>
              <ContributorEditor campuses={campuses} programs={programs} groups={groups} publicationId={publication.id} />
            </Suspense>
          </div>
        }
      />
      <PageBody className="space-y-5">
        <StatGrid columns={3}>
          <Stat label={tr("Contributors")} value={rows.length} hint={tr("on this newsletter")} />
          <Stat label={tr("Have contributed")} value={answered} hint={tr("at least one submission")} />
          <Stat label={tr("Elsewhere in your organisation")} value={others.length} hint={tr("not on this newsletter yet")} />
        </StatGrid>

        {publication.joinSlug && publication.isPublic ? (
          <ShareLinks title={tr("Share this link")} description={tr("Anybody who follows it puts themselves on this newsletter's contributor list.")} links={[{ label: publication.name, path: `/c/${publication.joinSlug}` }]} />
        ) : null}

        <DataTable
          rows={rows}
          rowKey={(c) => c.id}
          onRowHref={(c) => `/contributors/${c.id}`}
          dense
          empty={{ title: tr("Nobody writes for this newsletter yet"), description: tr("Add somebody, or share the link so people can put themselves forward."), icon: Users }}
          columns={[
            {
              key: "name",
              header: tr("Contributor"),
              cell: (c) => (
                <div className="min-w-0">
                  <Link href={`/contributors/${c.id}`} className="font-medium hover:underline">{c.firstName} {c.lastName}</Link>
                  <div className="truncate text-2xs text-muted-foreground">{c.email}</div>
                </div>
              ),
            },
            { key: "response", header: tr("Response"), cell: (c) => <span className="tabular text-xs">{c.responseRate === null ? "—" : `${Math.round((c.responseRate ?? 0) * 100)}%`}</span>, align: "right" },
            { key: "subs", header: tr("Submissions"), cell: (c) => <span className="tabular text-xs">{c.submissionsCount}</span>, align: "right" },
            { key: "last", header: tr("Last contribution"), cell: (c) => <span className="text-xs text-muted-foreground">{formatDate(c.lastContributionAt)}</span> },
            { key: "off", header: "", cell: (c) => <DetachContributor publicationId={publication.id} contributorId={c.id} name={`${c.firstName} ${c.lastName}`.trim()} />, width: "44px" },
          ]}
        />
      </PageBody>
    </>
  );
}
