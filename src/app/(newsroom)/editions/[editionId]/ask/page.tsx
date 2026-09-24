import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getEdition } from "@/server/editions/service";
import { getCampaignForEdition } from "@/server/campaigns/service";
import { listContributors } from "@/server/contributors/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { experienceOf } from "@/lib/experience";
import { normaliseBrief } from "@/lib/campaigns/brief";
import { getUi } from "@/server/i18n/locale";
import { AskForm } from "./ask-form";

export const dynamic = "force-dynamic";

/**
 * What are you asking for?
 *
 * The first real question of an edition, and it had no screen: it was a card two thirds of the way
 * down the campaign page, between the reminder dates and the email log, saved by a button that
 * also moved the deadline. Asking people for something is not a setting of the logistics of asking
 * them — it is the editorial decision the whole month hangs on — so it is a screen, and the screen
 * asks one question.
 */
export default async function AskPage({ params }: { params: Promise<{ editionId: string }> }) {
  const tr = await getUi();
  const { editionId } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "campaign:manage")) return <NoAccess title={tr("What are you asking for?")} permission="campaign:manage" />;
  const [edition, campaign, contributors] = await Promise.all([getEdition(editionId), getCampaignForEdition(editionId), listContributors({ active: "true" })]);
  const standard = experienceOf(user?.preferences) === "standard";
  const next = standard ? { href: `/editions/${editionId}` } : null;
  return (
    <>
      <PageHeader
        title={tr("What are you asking for?")}
        description={tr("Questions everybody answers, a topic handed to one person, or nothing at all — Briefly puts whatever you write here on their contribution form. {edition}", { edition: edition.label })}
      />
      <PageBody className="mx-auto w-full max-w-3xl">
        <AskForm
          editionId={editionId}
          initial={normaliseBrief(campaign?.brief)}
          initialIntro={campaign?.introMessage ?? ""}
          contributors={contributors.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() }))}
          canManage={hasPermission(user, "campaign:manage")}
          next={next?.href ?? null}
          nextLabel={tr("Save and go back")}
          title={tr("Done here?")}
          nextHint={tr("Saves what you changed and takes you back to the edition.")}
        />
      </PageBody>
    </>
  );
}
