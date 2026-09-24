import Link from "next/link";
import { Users } from "lucide-react";
import { campaignScreen } from "@/server/campaigns/read";
import { listContributors } from "@/server/contributors/service";
import { hasPermission, getCurrentUser } from "@/server/auth/session";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { CampaignSimpleForm, type AudienceValues } from "@/components/newsroom/campaign-simple-form";
import { SendInvitations } from "@/components/newsroom/send-invitations";
import { CreateCampaignButton } from "@/components/newsroom/campaign-controls";
import { ACTIVE_CAMPAIGN_STATUSES } from "@/server/campaigns/service";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";
import { formatZonedLong } from "@/lib/campaigns/schedule";
import { isSelectionMode, type SelectionMode } from "@/lib/campaigns/selection";
import { getUi } from "@/server/i18n/locale";

/**
 * Who are you asking?
 *
 * The same campaign as Advanced, asked as the question it is. What stood here was a phase
 * timeline, six counters, a coverage table, a five-line schedule, an automation log, an invitation
 * table, an eleven-field form and an email log — nine answers to a question nobody had asked yet.
 * Here it is three fields, one sentence saying how it is going, and the button that sends it.
 */
export async function StandardCampaign({ editionId }: { editionId: string }) {
  const tr = await getUi();
  const user = await getCurrentUser();
  const canManage = hasPermission(user, "campaign:manage");
  const screen = await campaignScreen(editionId);
  const { campaign, stats, edition } = screen;
  const next = { href: `/editions/${editionId}` };

  if (!campaign) {
    return (
      <>
        <PageHeader title={tr("Who are you asking?")} description={edition.label} />
        <PageBody className="mx-auto w-full max-w-3xl">
          <EmptyState
            icon={Users}
            title={tr("Nobody is being asked yet")}
            description={tr("Briefly invites the people you choose, reminds them twice, and closes the door for you. Set it up once and every edition after this one starts the same way.")}
            action={canManage ? <CreateCampaignButton editionId={editionId} /> : null}
          />
        </PageBody>
      </>
    );
  }

  const invited = stats?.invited ?? 0;
  const submitted = stats?.submitted ?? 0;
  const open = ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status);
  const standing = open
    ? invited
      ? submitted === 1
        ? tr("{invited} asked · 1 has answered", { invited })
        : tr("{invited} asked · {submitted} have answered", { invited, submitted })
      : tr("Open, and nobody has been invited yet.")
    : campaign.status === "CLOSED"
      ? tr("Closed on {date}.", { date: formatDate(campaign.closedAt ?? campaign.graceEndsAt) })
      : campaign.status === "SCHEDULED"
        ? tr("Set to go out on {date}.", { date: formatZonedLong(campaign.opensAt) })
        : tr("Nothing has been sent yet. Nobody hears from Briefly until you press the button.");

  const initial: AudienceValues = {
    selectionMode: (isSelectionMode(campaign.selectionMode) ? campaign.selectionMode : "DRAW") as SelectionMode,
    drawCount: campaign.drawCount ?? 0,
    contributorGroupIds: [...campaign.contributorGroupIds],
    selectedContributorIds: [...(campaign.selectedContributorIds ?? [])],
  };
  // The names themselves, so "the people I choose" can be done here rather than somewhere else.
  const people = (await listContributors({ active: "true" })).map((c) => ({
    id: c.id,
    name: `${c.firstName} ${c.lastName}`.trim() || c.email,
    email: c.email,
    groups: c.groupMemberships.map((membership) => membership.group.name),
  }));

  return (
    <>
      <PageHeader
        title={tr("Who are you asking?")}
        description={`${edition.label} · ${standing}`}
        actions={
          <>
            <Button asChild size="sm" variant="ghost">
              <Link href="/contributors">
                <Users /> {tr("Contributors")}
              </Link>
            </Button>
            {canManage && !open && campaign.status !== "CLOSED" ? <SendInvitations editionId={editionId} scheduledFor={campaign.status === "SCHEDULED" ? campaign.opensAt.toISOString() : null} /> : null}
          </>
        }
      />
      <PageBody className="mx-auto w-full max-w-3xl">
        <CampaignSimpleForm
          editionId={editionId}
          initial={initial}
          groups={screen.groups.map((g) => ({ id: g.id, name: g.name, description: g.description, members: g.members }))}
          people={people}
          canManage={canManage}
          closed={campaign.status === "CLOSED"}
          next={next?.href ?? null}
          nextLabel={tr("Save and go back")}
          nextHint={tr("Saves what you changed and takes you back to the edition.")}
          title={tr("Done here?")}
        />
      </PageBody>
    </>
  );
}
