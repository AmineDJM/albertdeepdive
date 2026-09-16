import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { editionSectionsWithCounts, getEdition, monthLabel } from "@/server/editions/service";
import { editionLanguages } from "@/server/editorial/article-list";
import { getCampaignDefaults } from "@/server/campaigns/settings";
import { listEditorCandidates } from "@/server/settings/users";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { EditionSettingsForm, type EditionSettingsInitial } from "@/components/newsroom/edition-settings-form";
import { EditionSettingsSections } from "@/components/newsroom/edition-settings-sections";
import { EditionSettingsCampaign, type ScheduleComparison } from "@/components/newsroom/edition-settings-campaign";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { Button } from "@/components/ui/button";
import { NoAccess } from "@/components/settings/no-access";
import { computeCampaignSchedule, formatZoned } from "@/lib/campaigns/schedule";

export const dynamic = "force-dynamic";

const LANGUAGE_NAMES: Record<string, string> = { en: "English", fr: "French", es: "Spanish", de: "German", it: "Italian" };

export default async function EditionSettingsPage({ params }: { params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "edition:edit")) return <NoAccess title="Edition settings" permission="edition:edit" />;
  const canEdit = hasPermission(user, "edition:edit");
  const canManageSections = hasPermission(user, "section:manage");
  const canManageCampaign = hasPermission(user, "campaign:manage");

  const [edition, sections, editors, defaults, languages] = await Promise.all([
    getEdition(editionId),
    editionSectionsWithCounts(editionId),
    listEditorCandidates(),
    getCampaignDefaults(),
    editionLanguages(editionId),
  ]);

  const campaign = edition.campaigns[0] ?? null;
  const schedule = computeCampaignSchedule({ month: edition.month, year: edition.year, defaults });

  const sameDay = (a: Date | null | undefined, b: Date) => (a ? formatZoned(a) === formatZoned(b) : false);
  const scheduleRows: ScheduleComparison[] = [
    { key: "opensAt", label: "Contribution request", current: campaign ? formatZoned(campaign.opensAt) : null, fromDefaults: formatZoned(schedule.opensAt), matches: sameDay(campaign?.opensAt, schedule.opensAt) },
    { key: "reminder1At", label: "Reminder #1", current: campaign ? formatZoned(campaign.reminder1At) : null, fromDefaults: formatZoned(schedule.reminder1At), matches: sameDay(campaign?.reminder1At, schedule.reminder1At) },
    { key: "reminder2At", label: "Reminder #2", current: campaign ? formatZoned(campaign.reminder2At) : null, fromDefaults: formatZoned(schedule.reminder2At), matches: sameDay(campaign?.reminder2At, schedule.reminder2At) },
    { key: "graceEndsAt", label: "Campaign closes", current: campaign ? formatZoned(campaign.graceEndsAt) : null, fromDefaults: formatZoned(schedule.graceEndsAt), matches: sameDay(campaign?.graceEndsAt, schedule.graceEndsAt) },
    { key: "finalReviewAt", label: "Final review", current: edition.finalReviewAt ? formatZoned(edition.finalReviewAt) : null, fromDefaults: formatZoned(schedule.finalReviewAt), matches: sameDay(edition.finalReviewAt, schedule.finalReviewAt) },
    { key: "publicationTargetAt", label: "Publication", current: edition.publicationTargetAt ? formatZoned(edition.publicationTargetAt) : null, fromDefaults: formatZoned(schedule.publicationTargetAt), matches: sameDay(edition.publicationTargetAt, schedule.publicationTargetAt) },
  ];

  const initial: EditionSettingsInitial = {
    label: edition.label,
    title: edition.title,
    isSpecialIssue: edition.isSpecialIssue,
    pageSize: edition.pageSize === "TABLOID" || edition.pageSize === "LETTER" ? edition.pageSize : "A4",
    targetPageCount: edition.targetPageCount,
    publicationTargetAt: edition.publicationTargetAt?.toISOString() ?? null,
    finalReviewAt: edition.finalReviewAt?.toISOString() ?? null,
    editorInChiefId: edition.editorInChiefId ?? "",
    coverHeadline: edition.coverHeadline ?? "",
    coverStandfirst: edition.coverStandfirst ?? "",
    tagline: edition.theme?.tagline ?? "",
    accentColour: edition.theme?.accentColour ?? "",
    coverTemplate: edition.theme?.coverTemplate ?? "",
    editorial: edition.editorial ?? "",
    notes: edition.notes ?? "",
  };

  const languageLabel = languages.length
    ? languages.map((l) => `${LANGUAGE_NAMES[l.code] ?? l.code} (${l.count})`).join(" · ")
    : "No article yet";

  return (
    <>
      <PageHeader
        title="Edition settings"
        description={`${edition.label} · ${sections.length} sections · ${edition.targetPageCount} target pages`}
        meta={<EditionStatusBadge status={edition.status} />}
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href={`/editions/${editionId}`}>
              Control room <ArrowRight />
            </Link>
          </Button>
        }
      />
      <PageBody className="max-w-6xl space-y-6">
        <EditionSettingsForm
          editionId={editionId}
          initial={initial}
          editors={editors.map((e) => ({ id: e.id, name: e.name }))}
          readOnly={!canEdit}
          meta={{
            issueNumber: edition.issueNumber,
            month: monthLabel(edition.month, edition.year),
            slug: edition.slug,
            language: languageLabel,
            sections: sections.length,
          }}
        />

        <section>
          <SectionTitle
            action={
              <span className="text-2xs text-muted-foreground">
                {canManageSections ? "Drag to reorder · slugs of existing sections are stable" : "You need the section:manage permission to edit these"}
              </span>
            }
          >
            Sections of this edition
          </SectionTitle>
          <EditionSettingsSections
            editionId={editionId}
            targetPageCount={edition.targetPageCount}
            canManage={canManageSections}
            sections={sections.map((s) => ({
              id: s.id,
              slug: s.slug,
              name: s.name,
              kicker: s.kicker,
              colour: s.colour,
              isHidden: s.isHidden,
              targetPages: s.targetPages,
              stories: s.stories,
              candidates: s.candidates,
            }))}
          />
        </section>

        <EditionSettingsCampaign
          editionId={editionId}
          rows={scheduleRows}
          campaignStatus={campaign?.status ?? null}
          canManage={canManageCampaign}
          defaultsSummary={`open on day ${defaults.openDay} at ${String(defaults.openHour).padStart(2, "0")}:00 · reminders on days ${defaults.reminder1Day} and ${defaults.reminder2Day} · closes on day ${defaults.graceDay} · final review day ${defaults.finalReviewDay} · publication day ${defaults.publicationDay}`}
        />
      </PageBody>
    </>
  );
}
