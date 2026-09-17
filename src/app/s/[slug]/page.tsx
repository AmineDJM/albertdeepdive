import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicationBySubscribeSlug } from "@/server/subscribers/service";
import { SubscribeForm } from "./subscribe-form";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const publication = await publicationBySubscribeSlug(slug);
  if (!publication) return { title: "Not found" };
  const title = `Subscribe to ${publication.name}`;
  return {
    title,
    description: publication.description ?? `Get ${publication.name} from ${publication.organization?.name ?? ""}.`.trim(),
    openGraph: { title, description: publication.description ?? undefined, type: "website" },
    robots: { index: true, follow: true },
  };
}

/**
 * The public subscribe page.
 *
 * It belongs to the customer, not to Briefly: their name, their colours, their words. Briefly's own
 * mark appears once, small, at the bottom — and on the plans that pay for it, not at all.
 */
export default async function SubscribePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const publication = await publicationBySubscribeSlug(slug);
  if (!publication) notFound();

  const org = publication.organization;
  const colours = (org?.brandColours ?? {}) as { primary?: string; accent?: string };
  const accent = colours.primary ?? colours.accent ?? "";
  const cadence = publication.cadence === "irregular" ? "when there is something worth sending" : `every ${publication.cadence.replace(/ly$/, "")}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          {org?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt="" className="mx-auto mb-4 h-10 object-contain" />
          ) : null}
          <p className="label-caps">{org?.name}</p>
          <h1 className="masthead mt-1 text-[30px] leading-tight font-semibold tracking-[-0.02em]">{publication.name}</h1>
          {publication.description ? <p className="mt-3 text-[14px] leading-6 text-muted-foreground">{publication.description}</p> : null}
          <p className="mt-2 text-xs text-muted-foreground">Published {cadence}.</p>
        </div>
        <SubscribeForm slug={slug} accent={accent} />
        <p className="mt-10 text-center text-2xs text-muted-foreground">
          Published with {BRAND.name}
        </p>
      </div>
    </main>
  );
}
