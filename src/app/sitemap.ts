import type { MetadataRoute } from "next";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

/**
 * The sitemap.
 *
 * Only what is genuinely public and genuinely worth indexing: the landing page, each open
 * publication's subscribe page, and each published web edition. Everything behind a sign-in is
 * absent, and so is anything a workspace has not published — an unpublished slug is a 404 anyway.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  const [publications, editions] = await Promise.all([
    db
      .select({ slug: s.publications.subscribeSlug, updatedAt: s.publications.updatedAt })
      .from(s.publications)
      .where(and(eq(s.publications.isPublic, true), eq(s.publications.status, "ACTIVE"))),
    db
      .select({ slug: s.editionOutputs.publicSlug, publishedAt: s.editionOutputs.publishedAt, updatedAt: s.editionOutputs.updatedAt })
      .from(s.editionOutputs)
      .where(and(eq(s.editionOutputs.format, "WEB"), eq(s.editionOutputs.status, "PUBLISHED"))),
  ]);

  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    ...publications
      .filter((p): p is { slug: string; updatedAt: Date } => !!p.slug)
      .map((p) => ({ url: `${base}/s/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
    ...editions
      .filter((e): e is { slug: string; publishedAt: Date | null; updatedAt: Date } => !!e.slug)
      .map((e) => ({ url: `${base}/r/${e.slug}`, lastModified: e.publishedAt ?? e.updatedAt, changeFrequency: "yearly" as const, priority: 0.8 })),
  ];
}
