import { notFound } from "next/navigation";
import { AlertTriangle, Check, ChevronRight, Info } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { getPack, qaFor } from "@/server/creative/service";
import { getStorage } from "@/server/storage";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Badge } from "@/components/ui/badge";
import { NoAccess } from "@/components/settings/no-access";
import { FORMATS, MODES } from "@/lib/creative/formats";
import { SYSTEMS } from "@/lib/creative/design-systems";
import { LAWS } from "@/lib/creative/laws";
import { lawFor } from "@/lib/creative/qa";
import { formatDateTime } from "@/lib/utils";
import { PackControls } from "./pack-controls";

export const dynamic = "force-dynamic";

/**
 * One pack: the frames, the caption, and what the quality check says.
 *
 * The frames shown are the rendered files, not a preview drawn a second way — a preview built by its
 * own layout pass is a preview that can disagree with what gets posted.
 */
export default async function PackPage({ params }: { params: Promise<{ packId: string }> }) {
  const { packId } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "edition:view")) return <NoAccess title="Studio" permission="edition:view" />;

  const pack = await getPack(packId).catch(() => null);
  if (!pack) notFound();

  const qa = qaFor(pack);
  const storage = getStorage();
  const frames = await Promise.all(
    pack.assets
      .filter((asset) => asset.kind === "FRAME")
      .sort((a, b) => a.index - b.index)
      .map(async (asset) => ({
        ...asset,
        url: asset.storageKey ? await storage.getSignedUrl(asset.storageKey, { expiresInSeconds: 3600 }) : null,
      })),
  );

  const format = FORMATS[pack.format];
  const defects = qa.findings.filter((finding) => finding.severity === "defect");
  const notes = qa.findings.filter((finding) => finding.severity === "note");

  return (
    <>
      <PageHeader
        title={pack.name}
        breadcrumbs={[{ label: "Studio", href: "/studio" }, { label: pack.name }]}
        description={`${format.name} · ${SYSTEMS[(pack.designSystem as keyof typeof SYSTEMS) ?? "editorial"]?.name ?? "Editorial"} · ${MODES[pack.mode].name} · ${format.width}×${format.height}`}
        meta={<Badge variant={pack.status === "READY" ? "success" : pack.status === "FAILED" ? "destructive" : "muted"}>{pack.status.toLowerCase()}</Badge>}
        actions={<PackControls packId={pack.id} status={pack.status} hasBrief={Boolean(pack.brief)} />}
      />
      <PageBody className="space-y-6">
        {pack.error ? (
          <p className="flex items-start gap-2 rounded-lg border border-coral-soft bg-coral-soft/40 px-3.5 py-2.5 text-[13px]">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-coral-deep" />
            {pack.error}
          </p>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <SectionTitle>{frames.length ? `${frames.length} frame${frames.length === 1 ? "" : "s"}` : "Frames"}</SectionTitle>
            {frames.length ? (
              <ul className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {frames.map((frame) => (
                  <li key={frame.id} className="overflow-hidden rounded-lg border border-border bg-card">
                    <span className="block bg-muted" style={{ aspectRatio: `${format.width} / ${format.height}` }}>
                      {frame.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={frame.url} alt={frame.alt ?? ""} className="size-full object-cover" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-2xs text-muted-foreground">{frame.status.toLowerCase()}</span>
                      )}
                    </span>
                    <span className="flex items-center justify-between gap-2 px-2 py-1.5 text-2xs text-muted-foreground">
                      <span>{frame.index + 1}</span>
                      <span>{frame.sizeBytes ? `${Math.round(frame.sizeBytes / 1024)} kB` : "—"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                {pack.status === "DRAFT" ? "Not directed yet." : "Rendering. This page updates when the frames arrive."}
              </p>
            )}
          </section>

          <aside className="space-y-5">
            <section>
              <SectionTitle>
                <span className="flex items-center gap-1.5">
                  {qa.verdict.ok ? <Check className="size-3.5 text-green-deep" /> : <AlertTriangle className="size-3.5 text-coral-deep" />}
                  {qa.verdict.summary}
                </span>
              </SectionTitle>
              {qa.findings.length ? (
                <ul className="space-y-2">
                  {[...defects, ...notes].map((finding, index) => {
                    const law = lawFor(finding);
                    return (
                      <li key={index} className="flex items-start gap-2 text-xs">
                        {finding.severity === "defect" ? (
                          <AlertTriangle className="mt-0.5 size-3 shrink-0 text-coral-deep" />
                        ) : (
                          <Info className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                        )}
                        <span>
                          <span className={finding.severity === "defect" ? "text-foreground" : "text-muted-foreground"}>
                            {finding.frame !== null ? <span className="font-medium">Frame {finding.frame + 1}: </span> : null}
                            {finding.message}
                          </span>
                          {law ? (
                            <span className="mt-0.5 block text-2xs text-muted-foreground">
                              {law.name} — {law.source}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">Everything fits, everything is readable.</p>
              )}
            </section>

            {/*
             * The rules the engine works to, with where each one comes from.
             *
             * Shown because a design decision nobody can question is a decision nobody can trust:
             * when Briefly narrows a column or quietens a headline, this is what said so. Folded
             * away because it is reference rather than news — the findings above are what changes
             * from pack to pack.
             */}
            <details className="group">
              <summary className="cursor-pointer list-none">
                <SectionTitle>
                  <span className="flex items-center gap-1.5">
                    <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
                    What Briefly held to · {LAWS.length} rules
                  </span>
                </SectionTitle>
              </summary>
              <ul className="space-y-2">
                {LAWS.map((law) => (
                  <li key={law.id} className="text-2xs">
                    <span className="flex items-baseline gap-1.5">
                      <span className="font-medium text-foreground">{law.name}</span>
                      <span className={law.kind === "enforced" ? "text-green-deep" : "text-muted-foreground"}>{law.kind === "enforced" ? "always" : "flagged"}</span>
                    </span>
                    <span className="block text-muted-foreground">{law.rule}</span>
                    <span className="block text-muted-foreground/70">{law.source}</span>
                  </li>
                ))}
              </ul>
            </details>

            {pack.brief ? (
              <section>
                <SectionTitle>Caption</SectionTitle>
                <p className="rounded-lg border border-border bg-card p-3 text-xs leading-5 whitespace-pre-wrap">{pack.brief.caption}</p>
                {pack.brief.hashtags.length ? (
                  <p className="mt-2 text-2xs text-muted-foreground">{pack.brief.hashtags.map((tag) => `#${tag}`).join(" ")}</p>
                ) : null}
              </section>
            ) : null}

            <section>
              <SectionTitle>What it cost</SectionTitle>
              <p className="text-xs text-muted-foreground">
                {Number(pack.costCents) > 0 ? `€${(Number(pack.costCents) / 100).toFixed(4)} so far.` : "Nothing — drawn entirely by Briefly."}
              </p>
              <p className="mt-1 text-2xs text-muted-foreground">Last change {formatDateTime(pack.updatedAt)}.</p>
            </section>
          </aside>
        </div>
      </PageBody>
    </>
  );
}
