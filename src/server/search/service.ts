import { and, desc, ilike, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";

export type SearchHit = { type: string; id: string; title: string; subtitle?: string; href: string; editionId?: string | null };

/** Command-K global search across the newsroom entities (ILIKE, fast enough for a school newsroom; embeddings can be added later). */
export async function globalSearch(rawQuery: string, limitPerGroup = 5): Promise<{ group: string; hits: SearchHit[] }[]> {
  const q = rawQuery.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const [editions, stories, articles, submissions, people, orgs, contributors, media, events, bdds] = await Promise.all([
    db.select({ id: s.editions.id, title: s.editions.title, label: s.editions.label, status: s.editions.status }).from(s.editions).where(or(ilike(s.editions.title, like), ilike(s.editions.label, like), ilike(s.editions.slug, like))).limit(limitPerGroup),
    db.select({ id: s.stories.id, title: s.stories.title, status: s.stories.status, editionId: s.stories.editionId }).from(s.stories).where(or(ilike(s.stories.title, like), ilike(s.stories.summary, like))).orderBy(desc(s.stories.updatedAt)).limit(limitPerGroup),
    db.select({ id: s.articles.id, headline: s.articles.headline, storyId: s.articles.storyId, editionId: s.articles.editionId, status: s.articles.status }).from(s.articles).where(or(ilike(s.articles.headline, like), ilike(s.articles.standfirst, like))).orderBy(desc(s.articles.updatedAt)).limit(limitPerGroup),
    db.select({ id: s.submissions.id, title: s.submissions.title, editionId: s.submissions.editionId, status: s.submissions.status }).from(s.submissions).where(and(or(ilike(s.submissions.title, like), ilike(s.submissions.description, like)), sql`${s.submissions.status} <> 'DRAFT'`)).orderBy(desc(s.submissions.createdAt)).limit(limitPerGroup),
    db.select({ id: s.people.id, name: s.people.fullName, role: s.people.role, mentions: s.people.mentionsCount }).from(s.people).where(ilike(s.people.fullName, like)).limit(limitPerGroup),
    db.select({ id: s.organisations.id, name: s.organisations.name, type: s.organisations.type }).from(s.organisations).where(ilike(s.organisations.name, like)).limit(limitPerGroup),
    db.select({ id: s.contributors.id, first: s.contributors.firstName, last: s.contributors.lastName, email: s.contributors.email, type: s.contributors.type }).from(s.contributors).where(or(ilike(s.contributors.firstName, like), ilike(s.contributors.lastName, like), ilike(s.contributors.email, like))).limit(limitPerGroup),
    db.select({ id: s.mediaAssets.id, fileName: s.mediaAssets.fileName, caption: s.mediaAssets.caption, editionId: s.mediaAssets.editionId }).from(s.mediaAssets).where(or(ilike(s.mediaAssets.fileName, like), ilike(s.mediaAssets.caption, like), ilike(s.mediaAssets.aiDescription, like))).limit(limitPerGroup),
    db.select({ id: s.events.id, title: s.events.title, dateText: s.events.dateText, storyId: s.events.storyId }).from(s.events).where(or(ilike(s.events.title, like), ilike(s.events.location, like))).limit(limitPerGroup),
    db.select({ id: s.businessDeepDives.id, company: s.businessDeepDives.companyName, cohort: s.businessDeepDives.cohortLabel, storyId: s.businessDeepDives.storyId }).from(s.businessDeepDives).where(or(ilike(s.businessDeepDives.companyName, like), ilike(s.businessDeepDives.cohortLabel, like), ilike(s.businessDeepDives.theMethods, like))).limit(limitPerGroup),
  ]);
  const groups: { group: string; hits: SearchHit[] }[] = [
    { group: "Editions", hits: editions.map((e) => ({ type: "edition", id: e.id, title: e.title, subtitle: `${e.label} · ${e.status}`, href: `/editions/${e.id}` })) },
    { group: "Stories", hits: stories.map((st) => ({ type: "story", id: st.id, title: st.title, subtitle: st.status, href: `/stories/${st.id}`, editionId: st.editionId })) },
    { group: "Articles", hits: articles.map((a) => ({ type: "article", id: a.id, title: a.headline || "(untitled article)", subtitle: a.status, href: `/articles/${a.id}`, editionId: a.editionId })) },
    { group: "Submissions", hits: submissions.map((sub) => ({ type: "submission", id: sub.id, title: sub.title, subtitle: sub.status, href: `/editions/${sub.editionId}/inbox/${sub.id}`, editionId: sub.editionId })) },
    { group: "Business Deep Dives", hits: bdds.map((b) => ({ type: "bdd", id: b.id, title: `${b.company}${b.cohort ? ` – ${b.cohort}` : ""}`, href: `/stories/${b.storyId}` })) },
    { group: "People", hits: people.map((p) => ({ type: "person", id: p.id, title: p.name, subtitle: p.role ?? `${p.mentions} mention${p.mentions === 1 ? "" : "s"}`, href: `/archive?person=${encodeURIComponent(p.name)}` })) },
    { group: "Organisations", hits: orgs.map((o) => ({ type: "organisation", id: o.id, title: o.name, subtitle: o.type, href: `/archive?organisation=${encodeURIComponent(o.name)}` })) },
    { group: "Contributors", hits: contributors.map((c) => ({ type: "contributor", id: c.id, title: `${c.first} ${c.last}`, subtitle: c.email, href: `/contributors/${c.id}` })) },
    { group: "Media", hits: media.map((m) => ({ type: "media", id: m.id, title: m.caption || m.fileName, subtitle: m.fileName, href: `/media/${m.id}`, editionId: m.editionId })) },
    { group: "Events", hits: events.map((ev) => ({ type: "event", id: ev.id, title: ev.title, subtitle: ev.dateText ?? undefined, href: ev.storyId ? `/stories/${ev.storyId}` : "/archive" })) },
  ];
  return groups.filter((g) => g.hits.length > 0);
}
