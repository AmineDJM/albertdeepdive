import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { listPacks, qaFor } from "@/server/creative/service";
import { listEditions } from "@/server/editions/service";
import { resolveEntitlements } from "@/server/billing/entitlements";
import { getStorage } from "@/server/storage";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { eq, inArray } from "drizzle-orm";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { HubTabs } from "@/components/newsroom/hub-tabs";
import { WORKBENCH_TABS } from "@/components/newsroom/nav";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { NoAccess } from "@/components/settings/no-access";
import { FORMATS, MODES } from "@/lib/creative/formats";
import { SYSTEMS } from "@/lib/creative/design-systems";
import { relativeTime } from "@/lib/utils";
import { NewPackDialog } from "./new-pack-dialog";

export const dynamic = "force-dynamic";

/**
 * Creative Studio.
 *
 * Every pack the workspace has made, newest first, each showing what it is, what state it is in and
 * whether it is ready to post. The cover is the contact sheet the renderer produced, so the list
 * shows the actual work rather than an icon standing in for it.
 */
export default async function StudioPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "edition:view")) return <NoAccess title="Studio" permission="edition:view" />;

  const tenant = await requireTenant();
  const [packs, editions, plan] = await Promise.all([listPacks(tenant.organizationId), listEditions(), resolveEntitlements(tenant.organizationId)]);
  const allowed = (plan.entitlements as Record<string, unknown>).socialPack !== false;

  // The cover of each pack, signed once here rather than per card.
  const covers = packs.length
    ? await db.query.creativeAssets.findMany({
        where: (asset, { and }) => and(inArray(asset.packId, packs.map((pack) => pack.id)), eq(s.creativeAssets.kind, "COVER")),
        columns: { packId: true, storageKey: true },
      })
    : [];
  const storage = getStorage();
  const coverUrls = new Map(
    await Promise.all(
      covers
        .filter((cover) => cover.storageKey)
        .map(async (cover) => [cover.packId, await storage.getSignedUrl(cover.storageKey!, { expiresInSeconds: 3600 })] as const),
    ),
  );

  return (
    <>
      <PageHeader
        title="Studio"
        description="Carousels, Stories and posts, set in your own brand. Briefly writes the words and draws every pixel — nothing is a picture of text."
        actions={allowed ? <NewPackDialog editions={editions.map((edition) => ({ id: edition.id, label: `${edition.label} · N°${edition.issueNumber}` }))} /> : null}
      >
        <HubTabs tabs={WORKBENCH_TABS} />
      </PageHeader>
      <PageBody className="space-y-4">
        {!allowed ? (
          <p className="rounded-lg border border-amber-soft bg-amber-soft/40 px-4 py-3 text-[13px]">Creative Studio is not included in this plan.</p>
        ) : null}

        {packs.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {packs.map((pack) => {
              const qa = qaFor(pack);
              const format = FORMATS[pack.format];
              const cover = coverUrls.get(pack.id);
              return (
                <li key={pack.id}>
                  <Link href={`/studio/${pack.id}`} className="block overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-brand/50">
                    <span className="block aspect-[16/9] w-full overflow-hidden bg-muted">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt="" className="size-full object-cover object-left-top" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-2xs text-muted-foreground">{pack.status === "DRAFT" ? "Not directed yet" : pack.status.toLowerCase()}</span>
                      )}
                    </span>
                    <span className="block p-3.5">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-medium">{pack.name}</span>
                          <span className="block truncate text-2xs text-muted-foreground">
                            {format.name} · {SYSTEMS[(pack.designSystem as keyof typeof SYSTEMS) ?? "editorial"]?.name ?? "Editorial"} · {MODES[pack.mode].name}
                          </span>
                        </span>
                        <StatusBadge status={pack.status} ok={qa.verdict.ok} />
                      </span>
                      <span className="mt-2 flex items-baseline justify-between gap-2 text-2xs text-muted-foreground">
                        <span>{qa.verdict.summary}</span>
                        <span>{relativeTime(pack.updatedAt)}</span>
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            title="Nothing made yet"
            description="Pick an edition and a format. Briefly reads what you published, writes the frames and renders them in your colours and your type."
            icon={Sparkles}
          />
        )}
      </PageBody>
    </>
  );
}

function StatusBadge({ status, ok }: { status: string; ok: boolean }) {
  if (status === "FAILED") return <Badge variant="destructive">needs a fix</Badge>;
  if (status === "READY") return ok ? <Badge variant="success">ready</Badge> : <Badge variant="warning">check it</Badge>;
  if (status === "DRAFT") return <Badge variant="muted">draft</Badge>;
  return <Badge variant="muted">{status.toLowerCase()}</Badge>;
}
