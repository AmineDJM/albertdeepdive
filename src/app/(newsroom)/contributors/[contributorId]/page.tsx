import Link from "next/link";
import { notFound } from "next/navigation";
import { getContributor, listCampusesWithStats, listGroups, listPrograms } from "@/server/contributors/service";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { SubmissionStatusBadge, GenericStatusBadge } from "@/components/newsroom/status-badge";
import { CampusChip } from "@/components/newsroom/campus-chip";
import { Badge } from "@/components/ui/badge";
import { ContributorEditor } from "../contributor-editor";
import { ContributorDangerZone } from "./danger-zone";
import { enumLabel, formatDate, formatDateTime } from "@/lib/utils";
import { storyTypeLabel } from "@/lib/constants";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function ContributorPage({ params }: { params: Promise<{ contributorId: string }> }) {
  const tr = await getUi();
  const { contributorId } = await params;
  const user = await getCurrentUser();
  const contributor = await getContributor(contributorId).catch(() => null);
  if (!contributor) notFound();
  const canManage = hasPermission(user, "contributor:manage");
  const [campuses, programs, groups] = canManage ? await Promise.all([listCampusesWithStats(), listPrograms(), listGroups()]) : [[], [], []];
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: tr("Contributors"), href: "/contributors" }, { label: `${contributor.firstName} ${contributor.lastName}` }]}
        title={`${contributor.firstName} ${contributor.lastName}`}
        meta={<>{contributor.campus ? <CampusChip name={contributor.campus.name} colour={contributor.campus.colour} /> : <Badge variant="muted">{tr("School-wide")}</Badge>}<Badge variant="outline">{tr(enumLabel(contributor.type))}</Badge>{!contributor.isActive ? <Badge variant="muted">{tr("Inactive")}</Badge> : null}</>}
        description={`${contributor.email} · ${contributor.program?.name ?? "no programme"} · prefers ${contributor.preferredLanguage === "fr" ? "French" : "English"}`}
        actions={canManage ? <ContributorEditor value={{ id: contributor.id, firstName: contributor.firstName, lastName: contributor.lastName, email: contributor.email, campusId: contributor.campusId, programId: contributor.programId, type: contributor.type, organisationName: contributor.organisationName, preferredLanguage: contributor.preferredLanguage as "en" | "fr", isActive: contributor.isActive, tags: contributor.tags, notes: contributor.notes, groupIds: contributor.groupMemberships.map((m) => m.groupId) }} campuses={campuses} programs={programs} groups={groups} /> : null}
      />
      <PageBody className="space-y-5">
        <StatGrid columns={4}>
          <Stat label={tr("Invitations")} value={contributor.invitationsCount} hint={contributor.lastInvitedAt ? `last ${formatDate(contributor.lastInvitedAt)}` : "never invited"} />
          <Stat label={tr("Submissions")} value={contributor.submissionsCount} hint={contributor.lastContributionAt ? `last ${formatDate(contributor.lastContributionAt)}` : "none yet"} />
          <Stat label={tr("Response rate")} value={contributor.responseRate === null ? "—" : `${Math.round(contributor.responseRate * 100)}%`} />
          <Stat label={tr("Pools")} value={contributor.groupMemberships.length} hint={contributor.groupMemberships.map((m) => m.group.name).join(", ") || "—"} />
        </StatGrid>
        <div className="grid gap-4 lg:grid-cols-2">
          <section>
            <SectionTitle>{tr("Submissions")}</SectionTitle>
            <div className="rounded-lg border bg-card">
              <ul className="divide-y">
                {contributor.submissions.length === 0 ? <li className="px-4 py-6 text-center text-xs text-muted-foreground">{tr("No submissions yet.")}</li> : null}
                {contributor.submissions.map((sub) => (
                  <li key={sub.id} className="flex items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <Link href={`/editions/${sub.editionId}/inbox/${sub.id}`} className="block truncate text-[13px] font-medium hover:underline">{sub.title}</Link>
                      <div className="text-2xs text-muted-foreground">{storyTypeLabel(sub.storyType)} · {sub.edition.label} · {formatDateTime(sub.submittedAt ?? sub.createdAt)}</div>
                    </div>
                    <SubmissionStatusBadge status={sub.status} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <section>
            <SectionTitle>{tr("Campaign history")}</SectionTitle>
            <div className="rounded-lg border bg-card">
              <ul className="divide-y">
                {contributor.requests.length === 0 ? <li className="px-4 py-6 text-center text-xs text-muted-foreground">{tr("Not invited yet.")}</li> : null}
                {contributor.requests.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{r.campaign.edition.label}</div>
                      <div className="text-2xs text-muted-foreground">{tr("Invited")}{" "}{formatDate(r.sentAt ?? r.createdAt)}{r.remindedCount ? ` · ${r.remindedCount} reminder${r.remindedCount > 1 ? "s" : ""}` : ""}{r.submittedAt ? ` · submitted ${formatDate(r.submittedAt)}` : ""}</div>
                    </div>
                    <GenericStatusBadge status={r.status} />
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
        {contributor.notes ? <section><SectionTitle>{tr("Notes")}</SectionTitle><p className="rounded-lg border bg-card p-3 text-[13px]">{contributor.notes}</p></section> : null}
        {hasPermission(user, "settings:manage") ? <ContributorDangerZone contributorId={contributor.id} isActive={contributor.isActive} /> : null}
      </PageBody>
    </>
  );
}
