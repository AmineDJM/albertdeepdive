import { CalendarClock } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getEdition } from "@/server/editions/service";
import { getCampaignForEdition } from "@/server/campaigns/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { EmptyState } from "@/components/ui/empty-state";
import { screenWords } from "@/components/newsroom/guided-words";
import { GUIDED_PATH, nextFrom, previousFrom } from "@/lib/editorial/guided-path";
import { experienceOf } from "@/lib/experience";
import { formatZonedLong, zonedDayInput } from "@/lib/campaigns/schedule";
import { getUi } from "@/server/i18n/locale";
import { SettingsCard } from "@/components/settings/key-value";
import { SendInvitations } from "@/components/newsroom/send-invitations";
import { ACTIVE_CAMPAIGN_STATUSES } from "@/server/campaigns/service";
import { DeadlineForm } from "./deadline-form";

export const dynamic = "force-dynamic";

/**
 * When for?
 *
 * One date, on its own screen, because it is its own decision. It shared a screen with who is
 * being asked, where it read as a detail of the invitation rather than the thing the whole month
 * is timed against — and everything Briefly does on its own hangs off it: two reminders, the day
 * of grace, and the moment the door closes.
 */
export default async function DeadlinePage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "campaign:manage")) return <NoAccess title={tr("When for?")} permission="campaign:manage" />;
  const [edition, campaign] = await Promise.all([getEdition(editionId), getCampaignForEdition(editionId)]);
  const standard = experienceOf(user?.preferences) === "standard";
  const at = GUIDED_PATH.findIndex((screen) => screen.room === "deadline");
  const next = standard ? nextFrom(editionId, "deadline") : null;
  const previous = standard ? previousFrom(editionId, "deadline") : null;
  const words = screenWords(tr);

  return (
    <>
      <PageHeader title={tr("When for?")} description={`${edition.label} · ${tr("The last day to send something in. Briefly reminds them twice before it, and accepts anything late for one more day.")}`} />
      <PageBody className="mx-auto w-full max-w-3xl">
        {campaign ? (
          <DeadlineForm
            editionId={editionId}
            initialDay={zonedDayInput(campaign.deadlineAt)}
            reminders={[campaign.reminder1At.toISOString(), campaign.reminder2At.toISOString()]}
            graceEndsAt={campaign.graceEndsAt.toISOString()}
            canManage={hasPermission(user, "campaign:manage")}
            closed={campaign.status === "CLOSED"}
            next={next?.href ?? null}
            nextLabel={words[GUIDED_PATH[at].key].cta}
            nextHint={tr("Step {step} of {total}", { step: at + 1, total: GUIDED_PATH.length })}
            title={tr("Next: {question}", { question: words[GUIDED_PATH[at + 1].key].question })}
            back={previous ? { href: previous.href, label: tr("Back") } : null}
            invitation={
              /*
               * The last screen before anything leaves the building.
               *
               * Who, what and by when have all been answered by now, so this is the moment the
               * invitation exists as a real email — and the moment to read it. Sending it is two
               * presses; dating it is one; neither happens by accident.
               */
              ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status) || campaign.status === "CLOSED" ? null : (
                <SettingsCard
                  title={tr("The invitation")}
                  description={
                    campaign.status === "SCHEDULED"
                      ? tr("Briefly sends it on its own on {date}. You can read it, move it, or send it now.", { date: formatZonedLong(campaign.opensAt) })
                      : tr("Nothing has gone out. Read what Briefly will send, then send it now or pick a date.")
                  }
                >
                  <SendInvitations editionId={editionId} scheduledFor={campaign.status === "SCHEDULED" ? campaign.opensAt.toISOString() : null} />
                </SettingsCard>
              )
            }
          />
        ) : (
          <EmptyState
            icon={CalendarClock}
            title={tr("There is nothing to date yet")}
            description={tr("The last day belongs to the invitation. Set up who you are asking first, and the date will be here.")}
          />
        )}
      </PageBody>
    </>
  );
}
