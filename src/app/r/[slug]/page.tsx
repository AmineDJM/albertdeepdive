import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { mediaUrls } from "@/server/media/urls";
import type { ArticleBlock } from "@/lib/publication/document";
import { BRAND } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * The public web edition.
 *
 * Nothing is rendered ahead of time: the page is built from the edition on request, so a correction
 * to an article appears without republishing. Publishing an edition is the act of making this
 * address answer at all — an unpublished slug is a 404, not a draft anybody can find.
 */
async function loadEdition(slug: string) {
  const output = await db.query.editionOutputs.findFirst({
    where: and(eq(s.editionOutputs.publicSlug, slug), eq(s.editionOutputs.format, "WEB"), eq(s.editionOutputs.status, "PUBLISHED")),
  });
  if (!output) return null;
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, output.editionId) });
  if (!edition) return null;
  const organization = edition.organizationId ? await db.query.organizations.findFirst({ where: eq(s.organizations.id, edition.organizationId) }) : null;
  const publication = edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId) }) : null;
  return { output, edition, organization, publication };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadEdition(slug);
  if (!loaded) return { title: "Not found" };
  const title = loaded.edition.coverHeadline || loaded.edition.title;
  const description = loaded.edition.coverStandfirst ?? loaded.publication?.description ?? undefined;
  const siteName = loaded.organization?.name ?? loaded.publication?.name;
  // `absolute` opts out of the app-wide "· Briefly" suffix: this page is the customer's, not ours.
  return { title: { absolute: title }, description, openGraph: { title, description, siteName, type: "article" }, robots: { index: true, follow: true } };
}

function Block({ block }: { block: ArticleBlock }) {
  switch (block.type) {
    case "paragraph":
      return <p className="mt-4 text-[17px] leading-[1.7] text-foreground/90">{block.text}</p>;
    case "crosshead":
      return <h3 className="masthead mt-8 text-[19px] font-semibold tracking-tight">{block.text}</h3>;
    case "pullquote":
      return (
        <blockquote className="my-7 border-l-2 border-foreground/20 pl-5">
          <p className="masthead text-[21px] leading-[1.4] font-medium">“{block.text}”</p>
        </blockquote>
      );
    case "testimony":
      return <p className="mt-4 border-l-2 border-foreground/15 pl-4 text-[16px] leading-[1.7] text-foreground/80 italic">{block.text}</p>;
    case "list":
      return (
        <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[17px] leading-[1.7] text-foreground/90">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case "qa":
      return (
        <div className="mt-5">
          <p className="text-[17px] leading-[1.7] font-semibold">{block.question}</p>
          <p className="mt-1.5 text-[17px] leading-[1.7] text-foreground/90">{block.answer}</p>
        </div>
      );
    case "box":
      return (
        <aside className="my-7 rounded-lg border border-border bg-muted/40 p-5">
          {block.title ? <p className="label-caps mb-2">{block.title}</p> : null}
          <p className="text-[15px] leading-[1.65] text-foreground/85">{block.text}</p>
          {block.items?.length ? (
            <ul className="mt-2.5 list-disc space-y-1 pl-5 text-[15px] leading-[1.6] text-foreground/85">
              {block.items.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
        </aside>
      );
    case "divider":
      return <hr className="my-8 border-border" />;
    case "image":
      return null; // placed by the article layout, not in the flow
  }
}

export default async function WebEditionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await loadEdition(slug);
  if (!loaded) notFound();
  const { edition, organization, publication } = loaded;

  const doc = await buildEditionDocument(edition.id, { versionLabel: "web" });
  const mediaIds = [doc.meta.cover.mediaId, ...doc.articles.map((a) => a.heroMediaId)].filter((id): id is string => !!id);
  const images = await mediaUrls(mediaIds, "WEB", 6 * 60 * 60);
  const sections = new Map(doc.sections.map((section) => [section.id, section]));
  // The cover story leads the page, as it leads the printed issue and the email. The flatplan
  // orders the rest, and a portrait hero is cropped rather than allowed to fill a whole screen.
  const articles = doc.meta.cover.articleId
    ? [...doc.articles].sort((a, b) => Number(b.id === doc.meta.cover.articleId) - Number(a.id === doc.meta.cover.articleId))
    : doc.articles;
  const brand = (organization?.brandColours ?? {}) as { primary?: string; accent?: string };
  const accent = brand.primary ?? brand.accent ?? undefined;

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-[720px] px-6 py-10 text-center">
          {organization?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={organization.logoUrl} alt="" className="mx-auto mb-4 h-8 object-contain" />
          ) : null}
          <p className="label-caps">{organization?.name}</p>
          <h1 className="masthead mt-1.5 text-[34px] leading-tight font-semibold tracking-[-0.02em]">{doc.meta.masthead.title}</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">
            {doc.meta.issueLabel} · {doc.meta.label}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-[720px] px-6 py-12">
        {doc.meta.editorial ? (
          <section className="mb-12 border-b border-border pb-10">
            <p className="label-caps mb-3">From the editor</p>
            <p className="text-[17px] leading-[1.7] text-foreground/85">{doc.meta.editorial}</p>
          </section>
        ) : null}

        {articles.map((article, index) => {
          const section = article.sectionId ? sections.get(article.sectionId) : undefined;
          const hero = article.heroMediaId ? images[article.heroMediaId] : null;
          return (
            <article key={article.id} id={article.id} className={index > 0 ? "mt-14 border-t border-border pt-12" : ""}>
              {section ? (
                <p className="label-caps mb-2" style={section.colour ? { color: section.colour } : undefined}>
                  {section.name}
                </p>
              ) : null}
              {article.kicker ? <p className="mb-1.5 text-[13px] font-semibold tracking-wide uppercase" style={accent ? { color: accent } : undefined}>{article.kicker}</p> : null}
              <h2 className="masthead text-[28px] leading-[1.15] font-semibold tracking-[-0.02em]">{article.headline}</h2>
              {article.standfirst ? <p className="mt-3 text-[18px] leading-[1.6] text-muted-foreground">{article.standfirst}</p> : null}
              {article.byline ? <p className="mt-3 text-[13px] text-muted-foreground">{article.byline}</p> : null}
              {hero ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hero} alt="" className="mt-6 max-h-[440px] w-full rounded-lg object-cover" />
              ) : null}
              {article.body.map((block, i) => (
                <Block key={i} block={block} />
              ))}
              {article.pullQuotes.length && !article.body.some((b) => b.type === "pullquote") ? (
                <blockquote className="my-7 border-l-2 border-foreground/20 pl-5">
                  <p className="masthead text-[21px] leading-[1.4] font-medium">“{article.pullQuotes[0].text}”</p>
                  {article.pullQuotes[0].attribution ? <cite className="mt-2 block text-[13px] text-muted-foreground not-italic">{article.pullQuotes[0].attribution}</cite> : null}
                </blockquote>
              ) : null}
            </article>
          );
        })}

        {articles.length === 0 ? <p className="text-[15px] text-muted-foreground">This edition has no published articles yet.</p> : null}
      </div>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-[720px] px-6 py-10 text-center text-[13px] text-muted-foreground">
          {publication?.isPublic && publication.subscribeSlug ? (
            <p>
              <Link href={`/s/${publication.subscribeSlug}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                Subscribe to {publication.name}
              </Link>{" "}
              to get the next edition.
            </p>
          ) : null}
          {doc.meta.credits.length ? <p className="mt-3 text-2xs">{doc.meta.credits.map((c) => `${c.role}: ${c.name}`).join(" · ")}</p> : null}
          <p className="mt-4 text-2xs">Published with {BRAND.name}</p>
        </div>
      </footer>
    </main>
  );
}
