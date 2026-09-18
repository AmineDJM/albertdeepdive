import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { mediaUrls } from "@/server/media/urls";
import { editionDashboard, getCurrentEdition } from "@/server/editions/service";
import { PHASES, phaseForStatus, type EditionPhase, type EditionStatus } from "@/lib/editorial/edition-state";

/**
 * What Home says.
 *
 * Three questions, answered from the workspace's own records: what is happening (the pulse), what
 * needs a person (the edition in hand and its gaps), what could go out next (the editions and the
 * shapes they take). Nothing here is a vanity figure: every number is one a person acts on.
 */

export type OutputKind = "EMAIL" | "WEB" | "MAGAZINE" | "PRINT" | "VIDEO" | "SOCIAL";
export const OUTPUT_KIND_LABELS: Record<OutputKind, string> = { EMAIL: "Email", WEB: "Web", MAGAZINE: "PDF", PRINT: "Print", VIDEO: "Video", SOCIAL: "Social" };

export type HomeEditionCard = {
  id: string;
  label: string;
  title: string;
  issueLabel: string;
  status: EditionStatus;
  coverUrl: string | null;
  coverHeadline: string | null;
  date: Date | null;
  outputs: OutputKind[];
  publishedOutputs: OutputKind[];
};

export type MissingKey = "submissions" | "stories" | "articles" | "pictures" | "facts";

export type HomeNext = {
  id: string;
  label: string;
  issueLabel: string;
  status: EditionStatus;
  phase: EditionPhase;
  /** How far along the seven phases, 0–1. */
  progress: number;
  coverUrl: string | null;
  missing: { key: MissingKey; count: number; href: string }[];
  outputs: OutputKind[];
  next: { label: string; href: string };
  target: Date | null;
  /** Stories chosen for it, and updates received: the two numbers Standard's one sentence uses. */
  stories: number;
  updates: number;
};

export type HomeData = {
  pulse: { contributions30: number; storiesReady: number; editionsInProgress: number; latest: { editionId: string; label: string; recipients: number; opened: number; openRate: number | null; formats: OutputKind[] } | null };
  next: HomeNext | null;
  recent: HomeEditionCard[];
};

const IN_PRODUCTION: EditionStatus[] = ["OPEN", "REMINDER_1", "REMINDER_2", "GRACE_PERIOD", "CLOSED", "PROCESSING", "EDITORIAL_REVIEW", "LAYOUT", "FINAL_REVIEW"];

function packKind(format: string): OutputKind {
  return format === "REEL" || format === "LINKEDIN_VIDEO" ? "VIDEO" : "SOCIAL";
}

/** Every shape an edition takes: the formats switched on, plus the studio's films and posts. */
export async function outputsFor(editionIds: string[]): Promise<Map<string, { all: OutputKind[]; published: OutputKind[] }>> {
  return editionOutputKinds(editionIds);
}

/** The same, under the name the editions list uses. */
export async function editionOutputKinds(editionIds: string[]): Promise<Map<string, { all: OutputKind[]; published: OutputKind[] }>> {
  const map = new Map<string, { all: OutputKind[]; published: OutputKind[] }>();
  if (!editionIds.length) return map;
  const [outputs, packs] = await Promise.all([
    db.select({ editionId: s.editionOutputs.editionId, format: s.editionOutputs.format, status: s.editionOutputs.status }).from(s.editionOutputs).where(inArray(s.editionOutputs.editionId, editionIds)),
    db.select({ editionId: s.creativePacks.editionId, format: s.creativePacks.format, status: s.creativePacks.status }).from(s.creativePacks).where(inArray(s.creativePacks.editionId, editionIds)),
  ]);
  const add = (editionId: string, kind: OutputKind, published: boolean) => {
    const entry = map.get(editionId) ?? { all: [], published: [] };
    if (!entry.all.includes(kind)) entry.all.push(kind);
    if (published && !entry.published.includes(kind)) entry.published.push(kind);
    map.set(editionId, entry);
  };
  for (const row of outputs) add(row.editionId, row.format, row.status === "PUBLISHED");
  for (const row of packs) if (row.editionId) add(row.editionId, packKind(row.format), row.status === "READY");
  return map;
}

/** The one thing to do next on an edition, from where it stands. */
export function nextActionFor(phase: EditionPhase, d: Awaited<ReturnType<typeof editionDashboard>>): { key: string; href: string } {
  const ed = `/editions/${d.edition.id}`;
  switch (phase) {
    case "COLLECT":
      return d.campaign ? { key: "review", href: `${ed}/inbox` } : { key: "collect", href: `${ed}/campaign` };
    case "ORGANISE":
      return d.submissions.needsReview ? { key: "triage", href: `${ed}/inbox?status=NEEDS_REVIEW` } : { key: "select", href: `${ed}/stories` };
    case "WRITE":
      return { key: "draft", href: `${ed}/articles` };
    case "EDIT":
      return { key: "approve", href: `${ed}/articles?status=READY_FOR_REVIEW` };
    case "LAYOUT":
      return { key: "layout", href: `${ed}/layout` };
    case "QA":
      return { key: "publish", href: `${ed}/qa` };
    default:
      return { key: "published", href: `${ed}` };
  }
}

export async function homeData(organizationId: string): Promise<HomeData> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [current, editions, [contrib], [ready], [inProgress]] = await Promise.all([
    getCurrentEdition(),
    db.query.editions.findMany({ where: and(eq(s.editions.organizationId, organizationId), isNull(s.editions.hiddenAt)), orderBy: [desc(s.editions.year), desc(s.editions.month), desc(s.editions.issueNumber)], limit: 8 }),
    db
      .select({ n: sql<number>`count(*)` })
      .from(s.submissions)
      .innerJoin(s.editions, eq(s.editions.id, s.submissions.editionId))
      .where(and(eq(s.editions.organizationId, organizationId), ne(s.submissions.status, "DRAFT"), gte(s.submissions.submittedAt, since))),
    db
      .select({ n: sql<number>`count(*) filter (where jsonb_array_length(${s.stories.warnings}) = 0 and not exists (select 1 from jsonb_array_elements(${s.stories.missingInformation}) m where coalesce((m->>'resolved')::boolean, false) = false))` })
      .from(s.stories)
      .innerJoin(s.editions, eq(s.editions.id, s.stories.editionId))
      .where(and(eq(s.editions.organizationId, organizationId), inArray(s.editions.status, IN_PRODUCTION), inArray(s.stories.status, ["SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED"]))),
    db.select({ n: sql<number>`count(*)` }).from(s.editions).where(and(eq(s.editions.organizationId, organizationId), isNull(s.editions.hiddenAt), inArray(s.editions.status, IN_PRODUCTION))),
  ]);

  const outputs = await outputsFor(editions.map((e) => e.id));
  const covers = await mediaUrls(editions.map((e) => e.coverMediaAssetId).filter((id): id is string => Boolean(id)), "WEB");
  const issueLabel = (e: { isSpecialIssue: boolean; issueNumber: number }) => `${e.isSpecialIssue ? "Special issue" : "Issue"} N°${e.issueNumber}`;

  const recent: HomeEditionCard[] = editions.map((e) => ({
    id: e.id,
    label: e.label,
    title: e.title,
    issueLabel: issueLabel(e),
    status: e.status,
    coverUrl: e.coverMediaAssetId ? (covers[e.coverMediaAssetId] ?? null) : null,
    coverHeadline: e.coverHeadline,
    date: e.publishedAt ?? e.publicationTargetAt,
    outputs: outputs.get(e.id)?.all ?? [],
    publishedOutputs: outputs.get(e.id)?.published ?? [],
  }));

  // The last thing that went out, and how it did by email — the one channel that reports back.
  const latestPublished = editions.find((e) => e.status === "PUBLISHED" || e.status === "ARCHIVED") ?? null;
  let latest: HomeData["pulse"]["latest"] = null;
  if (latestPublished) {
    const email = await db.query.editionOutputs.findFirst({ where: and(eq(s.editionOutputs.editionId, latestPublished.id), eq(s.editionOutputs.format, "EMAIL")) });
    const recipients = email?.recipientCount ?? 0;
    const opened = email?.openedCount ?? 0;
    latest = { editionId: latestPublished.id, label: latestPublished.label, recipients, opened, openRate: recipients ? opened / recipients : null, formats: outputs.get(latestPublished.id)?.published ?? [] };
  }

  let next: HomeNext | null = null;
  if (current && current.status !== "PUBLISHED" && current.status !== "ARCHIVED") {
    const d = await editionDashboard(current.id);
    const phase = phaseForStatus(current.status);
    const index = PHASES.findIndex((p) => p.key === phase);
    const ed = `/editions/${current.id}`;
    const action = nextActionFor(phase, d);
    next = {
      id: current.id,
      label: current.label,
      issueLabel: issueLabel(current),
      status: current.status,
      phase,
      progress: Math.max(0, index) / Math.max(1, PHASES.length - 1),
      coverUrl: current.coverMediaAssetId ? (covers[current.coverMediaAssetId] ?? null) : null,
      missing: (
        [
          { key: "submissions", count: d.submissions.needsReview, href: `${ed}/inbox?status=NEEDS_REVIEW` },
          { key: "stories", count: d.flags.storiesNeedingAttention, href: `${ed}/stories?flag=needs_attention` },
          { key: "articles", count: d.articles.ready, href: `${ed}/articles?status=READY_FOR_REVIEW` },
          { key: "pictures", count: d.media.yellow, href: `${ed}/media?rights=YELLOW` },
          { key: "facts", count: d.flags.disputedFacts, href: `${ed}/stories?flag=conflicts` },
        ] as { key: MissingKey; count: number; href: string }[]
      ).filter((item) => item.count > 0),
      outputs: outputs.get(current.id)?.all ?? [],
      next: { label: action.key, href: action.href },
      target: current.publicationTargetAt,
      stories: d.stories.selected,
      updates: d.submissions.total,
    };
  }

  return {
    pulse: { contributions30: Number(contrib.n), storiesReady: Number(ready.n), editionsInProgress: Number(inProgress.n), latest },
    next,
    recent,
  };
}
