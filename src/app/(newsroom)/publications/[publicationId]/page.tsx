import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, Globe, LayoutTemplate, Mail, Printer, Users } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { publicationWithEditions } from "@/server/outputs/service";
import { editionToInheritFrom, inheritedSettings } from "@/server/editions/service";
import { runAsOrganization } from "@/server/tenancy/context";
import { activeIdentity } from "@/server/design/identity";
import { standingOf } from "@/lib/editorial/edition-steps";
import type { EditionStatus } from "@/lib/editorial/edition-state";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/newsroom/data-table";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { NewEditionButton } from "./new-edition-button";
import { cn, enumLabel, formatDate, formatNumber } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const FORMAT_ICONS = { EMAIL: Mail, WEB: Globe, MAGAZINE: BookOpen, PRINT: Printer } as const;

/**
 * The newsletter, which is the thing that lasts, with its editions inside it.
 *
 * Briefly's model has always been right — a publication runs for years and an edition is what you
 * make each month — but the interface listed titles in a table and editions in another, so the
 * relationship you actually work in was something you had to hold in your head. This is that
 * relationship as a screen: the title at the top, the edition being worked on and exactly where it
 * has got to, one button to start the next one, and everything it has published underneath.
 *
 * The one loud action is "New edition", because that is the action. Making a *newsletter* happens
 * once and is rightly somewhere else.
 */
export default async function PublicationPage({ params }: { params: Promise<{ publicationId: string }> }) {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  const { publicationId } = await params;
  const data = await publicationWithEditions(publicationId, tenant.organizationId);
  if (!data) notFound();
  const { publication, editions, live, published, subscribers } = data;
  const canCreate = hasPermission(user, "edition:create");
  const canSetUp = hasPermission(user, "layout:edit");
  // What this title is made on, if anybody has said. Read here so the button can say which.
  const model = (await activeIdentity(publicationId)).source;

  // What the next edition would start from, said before anybody commits to it.
  const inherits = canCreate
    ? await runAsOrganization(tenant.organizationId, async () => inheritedSettings(await editionToInheritFrom(publication.id)))
    : null;

  return (
    <>
      <PageHeader
        title={publication.name}
        description={publication.description ?? tr("A recurring title. Each edition inside it starts where the last one left off.")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              * The model sits beside "New edition" because those are the two things a title has.
              * One makes this month; the other decides what every month is poured into.
              */}
            {canSetUp ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/publications/${publication.id}/blueprint`}>
                  <LayoutTemplate /> {model ? tr("The model") : tr("Choose a model")}
                </Link>
              </Button>
            ) : null}
            {canCreate ? <NewEditionButton publicationId={publication.id} inheritsFrom={inherits?.from.label ?? null} /> : null}
          </div>
        }
      />
      <PageBody className="space-y-6">
        <Link href="/publications" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> {tr("All titles")}
        </Link>

        {live ? (
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight">
                <Link href={`/editions/${live.id}`} className="hover:underline">
                  {tr("Edition")} #{live.issueNumber} · {live.label}
                </Link>
              </h2>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{tr(standingOf(live.status as EditionStatus))}</span>
                <EditionStatusBadge status={live.status} />
              </span>
            </div>
          </section>
        ) : (
          <section className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-[14px] font-medium">{tr("No edition yet")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{tr("Start the first one; everything you decide in it becomes the starting point for the next.")}</p>
          </section>
        )}

        <StatGrid columns={4}>
          <Stat label={tr("Editions")} value={formatNumber(editions.length)} hint={`${formatNumber(published)} ${tr("published")}`} />
          <Stat label={tr("Readers")} value={formatNumber(subscribers)} hint={tr("confirmed subscribers")} icon={Users} />
          <Stat
            label={tr("Usual formats")}
            value={
              publication.defaultFormats.length ? (
                <span className="flex items-center gap-1.5">
                  {publication.defaultFormats.map((format) => {
                    const Icon = FORMAT_ICONS[format as keyof typeof FORMAT_ICONS];
                    return Icon ? (
                      <span key={format} title={tr(enumLabel(format))} className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <Icon className="size-4" />
                      </span>
                    ) : null;
                  })}
                </span>
              ) : (
                "—"
              )
            }
            hint={tr("an edition may still choose its own")}
          />
          <Stat label={tr("Cadence")} value={tr(enumLabel(publication.cadence))} hint={publication.language.toUpperCase()} />
        </StatGrid>

        <section>
          <SectionTitle>{tr("Every edition")}</SectionTitle>
          <DataTable
            rows={editions}
            rowKey={(edition) => edition.id}
            dense
            empty={{ title: tr("No edition yet"), description: tr("The first edition of a title is the one that decides how the rest of them start.") }}
            columns={[
              {
                key: "issue",
                header: tr("Edition"),
                cell: (edition) => (
                  <Link href={`/editions/${edition.id}`} className="font-medium hover:underline">
                    #{edition.issueNumber} · {edition.label}
                  </Link>
                ),
              },
              { key: "title", header: tr("Title"), cell: (edition) => <span className="line-clamp-1 text-xs text-muted-foreground">{edition.title}</span> },
              {
                key: "standing",
                header: tr("Where it is"),
                cell: (edition) => <span className={cn("text-xs", edition.id === live?.id && "font-medium text-foreground")}>{tr(standingOf(edition.status as EditionStatus))}</span>,
              },
              { key: "status", header: tr("Status"), cell: (edition) => <EditionStatusBadge status={edition.status} /> },
              {
                key: "date",
                header: tr("Published"),
                cell: (edition) => <span className="text-2xs text-muted-foreground">{edition.publishedAt ? formatDate(edition.publishedAt) : edition.publicationTargetAt ? `${tr("due")} ${formatDate(edition.publicationTargetAt)}` : "—"}</span>,
                align: "right",
              },
            ]}
          />
        </section>
      </PageBody>
    </>
  );
}
