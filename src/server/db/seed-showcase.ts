import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";

/**
 * Something beautiful in the gallery on day one.
 *
 * A gallery whose whole argument is "look what real organisations made" cannot open empty, and it
 * must not open with a customer's work in it. So Briefly seeds workspaces it owns: two demo
 * organisations, marked `isDemo`, whose consent is `PLATFORM_DEMO` because there is no customer to
 * ask. Albert School, which is the seed's *customer*, stays at `NONE` — and the end-to-end test
 * checks that it never appears, which is the privacy rule stated as an assertion rather than a
 * promise.
 */

type DemoEdition = {
  label: string;
  title: string;
  headline: string;
  standfirst: string;
  slug: string;
  month: number;
  year: number;
  publishedAt: Date;
};

type DemoOrg = {
  name: string;
  slug: string;
  type: (typeof s.organizationTypeEnum.enumValues)[number];
  description: string;
  website: string;
  language: string;
  publication: { name: string; slug: string; description: string; cadence: string; formats: string[] };
  editions: DemoEdition[];
};

const DEMOS: DemoOrg[] = [
  {
    name: "Northgate University",
    slug: "northgate-university",
    type: "UNIVERSITY",
    description: "A civic university of 24,000 students, telling its own story every month.",
    website: "https://northgate.example.edu",
    language: "en",
    publication: { name: "The Northgate Review", slug: "northgate-review", description: "What happened on campus, written by the people it happened to.", cadence: "monthly", formats: ["EMAIL", "WEB", "MAGAZINE"] },
    editions: [
      { label: "March 2026", title: "The Northgate Review — March 2026", headline: "The year the labs opened their doors", standfirst: "Twelve departments, one building, and the first undergraduate cohort to use it.", slug: "northgate-review-march-2026", month: 3, year: 2026, publishedAt: new Date("2026-03-18T09:00:00Z") },
      { label: "February 2026", title: "The Northgate Review — February 2026", headline: "Nine thousand hours of volunteering", standfirst: "What students did with the winter term, counted properly for the first time.", slug: "northgate-review-february-2026", month: 2, year: 2026, publishedAt: new Date("2026-02-16T09:00:00Z") },
    ],
  },
  {
    name: "Meridian Labs",
    slug: "meridian-labs",
    type: "COMPANY",
    description: "A forty-person engineering company that publishes what it learns.",
    website: "https://meridianlabs.example.com",
    language: "en",
    publication: { name: "Meridian Monthly", slug: "meridian-monthly", description: "Shipping notes, hiring, and the things that did not work.", cadence: "monthly", formats: ["EMAIL", "WEB"] },
    editions: [
      { label: "April 2026", title: "Meridian Monthly — April 2026", headline: "We rewrote the scheduler, and told everyone why", standfirst: "Four weeks, one subsystem, and the numbers before and after.", slug: "meridian-monthly-april-2026", month: 4, year: 2026, publishedAt: new Date("2026-04-02T08:00:00Z") },
    ],
  },
  {
    name: "Rivermouth Collective",
    slug: "rivermouth-collective",
    type: "COMMUNITY",
    description: "Six hundred neighbours, one newsletter, no office.",
    website: "https://rivermouth.example.org",
    language: "fr",
    publication: { name: "La Gazette de Rivermouth", slug: "gazette-rivermouth", description: "Ce qui se passe dans le quartier, raconté par le quartier.", cadence: "fortnightly", formats: ["EMAIL", "WEB"] },
    editions: [
      { label: "Janvier 2026", title: "La Gazette de Rivermouth — Janvier 2026", headline: "La halle rouvre, et le marché revient", standfirst: "Dix-huit mois de travaux, trente-quatre étals, une seule journée d’ouverture.", slug: "gazette-rivermouth-janvier-2026", month: 1, year: 2026, publishedAt: new Date("2026-01-20T10:00:00Z") },
    ],
  },
];

const COLLECTIONS = [
  { slug: "featured-this-month", title: "Featured this month", tagline: "What we would show a friend first.", category: "featured", isFeatured: true, pinnedOrder: 0, take: ["northgate-review-march-2026", "meridian-monthly-april-2026", "gazette-rivermouth-janvier-2026"] },
  { slug: "universities", title: "Universities", tagline: "How campuses tell their own story.", category: "UNIVERSITY", isFeatured: true, pinnedOrder: 1, take: ["northgate-review-march-2026", "northgate-review-february-2026"] },
  { slug: "communities", title: "Communities", tagline: "Neighbourhoods, associations and the people who hold them together.", category: "COMMUNITY", isFeatured: true, pinnedOrder: 2, take: ["gazette-rivermouth-janvier-2026"] },
  { slug: "companies", title: "Companies", tagline: "Internal newsletters people actually read.", category: "COMPANY", isFeatured: false, pinnedOrder: null, take: ["meridian-monthly-april-2026"] },
];

/** Builds the demo workspaces and the collections that show them. Safe to run on an empty database. */
export async function seedShowcase(createdById: string | null) {
  const bySlug = new Map<string, string>();
  let issueNumber = 1;

  for (const demo of DEMOS) {
    const [organization] = await db
      .insert(s.organizations)
      .values({ name: demo.name, slug: demo.slug, type: demo.type, website: demo.website, description: demo.description, locale: demo.language, isDemo: true, onboardedAt: new Date() })
      .returning();
    const [publication] = await db
      .insert(s.publications)
      .values({
        organizationId: organization.id,
        name: demo.publication.name,
        slug: demo.publication.slug,
        description: demo.publication.description,
        language: demo.language,
        cadence: demo.publication.cadence,
        defaultFormats: demo.publication.formats,
        // Briefly's own workspace: there is no customer to ask, and the record says so.
        showcaseConsent: "PLATFORM_DEMO",
        showcaseNote: "A workspace Briefly runs for the gallery.",
        showcaseConsentAt: new Date(),
        showcaseConsentById: createdById,
        createdById,
      })
      .returning();

    for (const edition of demo.editions) {
      const [row] = await db
        .insert(s.editions)
        .values({
          organizationId: organization.id,
          publicationId: publication.id,
          issueNumber: issueNumber++,
          title: edition.title,
          slug: edition.slug,
          label: edition.label,
          month: edition.month,
          year: edition.year,
          status: "PUBLISHED",
          coverHeadline: edition.headline,
          coverStandfirst: edition.standfirst,
          publicationTargetAt: edition.publishedAt,
          finalReviewAt: edition.publishedAt,
          publishedAt: edition.publishedAt,
          createdById,
        })
        .returning();
      // The public web page is what the gallery links to; without it nothing is showable at all.
      for (const format of demo.publication.formats) {
        await db.insert(s.editionOutputs).values({
          editionId: row.id,
          organizationId: organization.id,
          format: format as (typeof s.outputFormatEnum.enumValues)[number],
          status: "PUBLISHED",
          publicSlug: format === "WEB" ? edition.slug : null,
          publishedAt: edition.publishedAt,
        });
      }
      bySlug.set(edition.slug, row.id);
    }
  }

  for (const [index, spec] of COLLECTIONS.entries()) {
    const [collection] = await db
      .insert(s.collections)
      .values({
        slug: spec.slug,
        title: spec.title,
        tagline: spec.tagline,
        category: spec.category,
        isPublished: true,
        isFeatured: spec.isFeatured,
        pinnedOrder: spec.pinnedOrder,
        sortOrder: index,
        createdById,
      })
      .returning();
    const editionIds = spec.take.map((slug) => bySlug.get(slug)).filter((id): id is string => Boolean(id));
    if (editionIds.length) {
      await db.insert(s.collectionItems).values(editionIds.map((editionId, order) => ({ collectionId: collection.id, editionId, sortOrder: order, isFeatured: order === 0, addedById: createdById })));
    }
  }

  return { organizations: DEMOS.length, collections: COLLECTIONS.length, editions: bySlug.size };
}
