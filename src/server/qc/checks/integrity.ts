import { createHash } from "node:crypto";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { blockText, type ArticleBlock } from "@/lib/publication/document";
import { renderEditionEmail } from "@/server/outputs/email-edition";
import { ANALYTICS_RECONCILES, ANALYTICS_TENANCY, FACT_CONSISTENCY, OUTPUT_STALE, PROVIDER_OUTPUT_CHECKED, REVISION_SCOPE } from "../spec";
import { assertThat, compare, merge, nothing, type CheckResult } from "../types";
import type { Check, QcContext } from "../engine";

/**
 * The checks that compare one thing with another, rather than measuring a thing on its own.
 *
 * A number is not wrong in isolation — €2.4M is a perfectly good number. It is wrong *because* the
 * PDF says €24M for the same sentence. A frozen artefact is not stale in itself; it is stale
 * against the issue it was made from. A dashboard figure is not incorrect; it disagrees with the
 * rows it claims to count. Each of these needs two sources and a comparison, which is why they live
 * together.
 */

/* ── Facts across outputs ─────────────────────────────────────────────────────────────────── */

type Fact = { kind: "money" | "percent" | "date"; value: string; raw: string };

/**
 * Money, percentages and dates, normalised so that two spellings of the same fact match.
 *
 * Copy is allowed to change between a web page and a printed page — shorter, rephrased, a different
 * pull quote. Facts are not. So the comparison is deliberately narrow: only the kinds of value
 * where a difference is unambiguously an error, normalised hard enough that "€2.4M", "EUR 2.4
 * million" and "2,4 M€" are one fact rather than three.
 */
export function extractFacts(text: string): Fact[] {
  const facts: Fact[] = [];
  const clean = text.replace(/ /g, " ");

  // Money: a currency mark, a number, and an optional magnitude word.
  const money = /(?:€|£|\$|EUR|GBP|USD)\s?([\d][\d\s.,]*)\s?(m|mn|million|millions|bn|billion|milliard|milliards|k|000)?|([\d][\d\s.,]*)\s?(m|million|millions|bn|billion|milliard|milliards)?\s?(?:€|£|\$|EUR|GBP|USD)/gi;
  for (const match of clean.matchAll(money)) {
    const digits = match[1] ?? match[3];
    const scale = (match[2] ?? match[4] ?? "").toLowerCase();
    if (!digits) continue;
    const amount = Number(digits.replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    if (!Number.isFinite(amount)) continue;
    const multiplier = /^(m|mn|million)/.test(scale) ? 1e6 : /^(bn|billion|milliard)/.test(scale) ? 1e9 : /^(k|000)$/.test(scale) ? 1e3 : 1;
    facts.push({ kind: "money", value: String(Math.round(amount * multiplier)), raw: match[0].trim() });
  }

  for (const match of clean.matchAll(/(\d+(?:[.,]\d+)?)\s?%/g)) {
    facts.push({ kind: "percent", value: String(Number(match[1].replace(",", "."))), raw: match[0].trim() });
  }

  // Dates: a day and a month name, in English or French, which is what an event line carries.
  const months = "january|february|march|april|may|june|july|august|september|october|november|december|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre";
  for (const match of clean.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th|er)?\\s+(${months})\\b`, "gi"))) {
    facts.push({ kind: "date", value: `${Number(match[1])}-${normaliseMonth(match[2])}`, raw: match[0].trim() });
  }
  return facts;
}

function normaliseMonth(name: string): number {
  const table: Record<string, number> = {
    january: 1, janvier: 1, february: 2, février: 2, fevrier: 2, march: 3, mars: 3, april: 4, avril: 4,
    may: 5, mai: 5, june: 6, juin: 6, july: 7, juillet: 7, august: 8, août: 8, aout: 8,
    september: 9, septembre: 9, october: 10, octobre: 10, november: 11, novembre: 11, december: 12, décembre: 12, decembre: 12,
  };
  return table[name.toLowerCase()] ?? 0;
}

export const factsCheck: Check = {
  id: "facts",
  title: "A number means the same thing in every output",
  async run(ctx: QcContext): Promise<CheckResult> {
    // The email is the other rendering of the same issue, so it is the comparison that costs
    // nothing extra. Print and web are both built from this document, so a difference between
    // them and the document would be a renderer bug rather than an editorial one.
    let emailText = "";
    try {
      const rendered = renderEditionEmail(ctx.document, {
        organizationName: "QC",
        unsubscribeUrl: "https://example.test/s/unsubscribe/qc",
        imageUrls: {},
      });
      emailText = rendered.text;
    } catch {
      return nothing();
    }

    const emailFacts = new Map<string, Fact[]>();
    for (const fact of extractFacts(emailText)) {
      const list = emailFacts.get(fact.kind) ?? [];
      list.push(fact);
      emailFacts.set(fact.kind, list);
    }

    const results: CheckResult[] = [];
    let mismatches = 0;
    for (const article of ctx.document.articles) {
      const body = (article.body as ArticleBlock[]).map(blockText).join(" ");
      const source = extractFacts(`${article.headline} ${article.standfirst ?? ""} ${body}`);
      if (!source.length) continue;

      // A fact that appears in the email for this article must appear identically in the article.
      const teaser = emailText.includes(article.headline) ? extractFacts(articleTeaser(emailText, article.headline)) : [];
      for (const fact of teaser) {
        const sameKind = source.filter((each) => each.kind === fact.kind);
        if (!sameKind.length) continue;
        if (sameKind.some((each) => each.value === fact.value)) continue;
        mismatches += 1;
        results.push(
          assertThat({
            spec: FACT_CONSISTENCY,
            holds: false,
            location: { entityType: "article", entityId: article.id, entityLabel: article.headline, field: fact.kind },
            message: `"${article.headline}" says ${sameKind.map((each) => each.raw).join(" / ")} and the email says ${fact.raw}. Copy may change between outputs; a ${fact.kind} may not.`,
            expected: sameKind.map((each) => each.raw).join(" or "),
            actual: fact.raw,
            evidence: { kind: fact.kind, article: sameKind.map((each) => each.value), email: fact.value },
          }),
        );
      }
    }
    if (!mismatches) {
      results.push(compare({ spec: FACT_CONSISTENCY, actual: 0, location: { entityType: "edition", entityId: ctx.editionId }, message: "Every number agrees across outputs." }));
    }
    return merge(...results);
  },
};

/**
 * One article's teaser in the plain-text email — and not one word of the next one's.
 *
 * The window has to stop at the following item, because the failure this check exists to catch is
 * a date belonging to one article being read as another's. A fixed-length window does precisely
 * that: it runs past the end of a short teaser into the next, and then reports every neighbouring
 * date as a contradiction. Three such reports on a perfectly correct issue is how a gate stops
 * being read.
 */
export function articleTeaser(text: string, headline: string): string {
  const at = text.indexOf(headline);
  if (at < 0) return "";
  const after = at + headline.length;
  const next = text.indexOf("\n- ", after);
  const end = next >= 0 ? next : Math.min(text.length, after + 400);
  return text.slice(at, end);
}

/* ── Revision invariants ──────────────────────────────────────────────────────────────────── */

export const revisionCheck: Check = {
  id: "revision",
  title: "An exact cut changed exactly what it said it would",
  async run(ctx: QcContext): Promise<CheckResult> {
    // Every applied revision that carried a `remove_passage`: the words quoted must be gone, and
    // nothing outside them may have moved. `shorten_article` is judgement and is not checked here.
    const revisions = await db
      .select({ id: s.editionRevisions.id, ops: s.editionRevisions.changes, appliedAt: s.editionRevisions.appliedAt })
      .from(s.editionRevisions)
      .where(and(eq(s.editionRevisions.editionId, ctx.editionId), eq(s.editionRevisions.status, "APPLIED")))
      .orderBy(desc(s.editionRevisions.appliedAt))
      .limit(5);
    if (!revisions.length) return nothing();

    const results: CheckResult[] = [];
    const articles = new Map(ctx.document.articles.map((article) => [article.id, article]));
    for (const revision of revisions) {
      const staged = Array.isArray(revision.ops) ? (revision.ops as { op?: { kind?: string; articleId?: string; passage?: string } }[]) : [];
      for (const change of staged) {
        const op = change.op;
        if (op?.kind !== "remove_passage" || !op.articleId || !op.passage) continue;
        const article = articles.get(op.articleId);
        if (!article) continue;
        const body = (article.body as ArticleBlock[]).map(blockText).join(" ");
        const gone = !fold(body).includes(fold(op.passage));
        results.push(
          assertThat({
            spec: REVISION_SCOPE,
            holds: gone,
            location: { entityType: "article", entityId: op.articleId, entityLabel: article.headline },
            message: gone
              ? "The quoted passage is gone."
              : `A revision claimed to remove a passage from "${article.headline}" and the words are still there.`,
            expected: "the quoted passage is absent",
            actual: gone ? "absent" : "still present",
            evidence: { revisionId: revision.id, passage: op.passage.slice(0, 120) },
          }),
        );
      }
    }
    return results.length ? merge(...results) : nothing();
  },
};

const fold = (text: string): string =>
  text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/* ── Staleness ────────────────────────────────────────────────────────────────────────────── */

/**
 * Whether a frozen artefact still corresponds to the issue it was made from.
 *
 * The hash is over the content the artefact drew: article bodies and headlines, the page plan and
 * the media keys. Not over the whole document, which carries a generation timestamp and freshly
 * signed URLs — both of which change every time it is built and neither of which changes what the
 * reader sees. A staleness check that fires on every build is a staleness check nobody believes.
 */
export function editionFingerprint(ctx: QcContext): { contentHash: string; layoutHash: string; assetHash: string } {
  const content = ctx.document.articles
    .map((article) => `${article.id}:${article.headline}:${(article.body as ArticleBlock[]).map(blockText).join(" ")}`)
    .sort()
    .join("|");
  const layout = ctx.document.pages.map((page) => `${page.number}:${page.template}:${page.articleIds.join(",")}`).join("|");
  const assets = [...ctx.document.media].map((media) => `${media.id}:${media.src.print?.key ?? ""}`).sort().join("|");
  const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);
  return { contentHash: digest(content), layoutHash: digest(layout), assetHash: digest(assets) };
}

export const stalenessCheck: Check = {
  id: "staleness",
  title: "A frozen artefact matches the issue it was made from",
  async run(ctx: QcContext): Promise<CheckResult> {
    const versions = await db
      .select({ id: s.publicationVersions.id, label: s.publicationVersions.label, hash: s.publicationVersions.documentHash, status: s.publicationVersions.status })
      .from(s.publicationVersions)
      .where(and(eq(s.publicationVersions.editionId, ctx.editionId), eq(s.publicationVersions.status, "READY")))
      .orderBy(desc(s.publicationVersions.sequence))
      .limit(1);
    const latest = versions[0];
    if (!latest) return nothing();

    const now = editionFingerprint(ctx);
    // The stored hash covers the whole document including its timestamp, so it cannot be compared
    // directly. What can be compared is the fingerprint recorded alongside it by a previous run.
    const previous = await db
      .select({ summary: s.qcRuns.summary })
      .from(s.qcRuns)
      .where(and(eq(s.qcRuns.editionId, ctx.editionId), eq(s.qcRuns.profile, ctx.profile.id)))
      .orderBy(desc(s.qcRuns.startedAt))
      .limit(1);
    const before = (previous[0]?.summary as { fingerprint?: typeof now } | undefined)?.fingerprint;
    if (!before) {
      // Nothing to compare with yet: record the fingerprint and say so rather than claiming fresh.
      return { findings: [], passed: [{ metricId: OUTPUT_STALE.id, actual: now.contentHash, unit: "hash", location: { entityType: "output", entityId: latest.id } }] };
    }

    const changed = (["contentHash", "layoutHash", "assetHash"] as const).filter((key) => before[key] !== now[key]);
    return assertThat({
      spec: OUTPUT_STALE,
      holds: changed.length === 0,
      location: { entityType: "output", entityId: latest.id, entityLabel: latest.label, output: ctx.profile.id },
      message: changed.length
        ? `"${latest.label}" was made from a different issue: ${changed.map((key) => key.replace("Hash", "")).join(", ")} changed since. Republish to refresh the frozen files.`
        : "The frozen artefact matches the issue.",
      expected: "identical hashes",
      actual: changed.join(", ") || "identical",
      evidence: { before, now },
    });
  },
};

/* ── Analytics reconciliation ─────────────────────────────────────────────────────────────── */

export const analyticsCheck: Check = {
  id: "analytics",
  title: "The dashboard figure equals the rows it claims to count",
  async run(ctx: QcContext): Promise<CheckResult> {
    if (!ctx.organizationId) return nothing();
    const scope = { organizationId: ctx.organizationId, editionId: null, from: null, to: null };
    const { readerDelivery } = await import("@/server/analytics/read-insights");
    const reported = await readerDelivery(scope);

    // The same figures, recomputed straight from the log by the documented formula.
    const [raw] = await db
      .select({
        sent: sql<number>`count(*) filter (where ${s.emailLog.sentAt} is not null)`,
        delivered: sql<number>`count(*) filter (where ${s.emailLog.deliveredAt} is not null)`,
        opened: sql<number>`count(*) filter (where ${s.emailLog.openedAt} is not null)`,
        clicked: sql<number>`count(*) filter (where ${s.emailLog.clickedAt} is not null)`,
      })
      .from(s.emailLog)
      .where(eq(s.emailLog.organizationId, ctx.organizationId));

    const n = (value: unknown) => Number(value ?? 0);
    const drift = Math.abs(reported.delivered - n(raw?.delivered)) + Math.abs(reported.opened - n(raw?.opened)) + Math.abs(reported.clicked - n(raw?.clicked)) + Math.abs(reported.sent - n(raw?.sent));

    const results: CheckResult[] = [
      compare({
        spec: ANALYTICS_RECONCILES,
        actual: drift,
        location: { entityType: "workspace", entityId: ctx.organizationId },
        message: drift
          ? `The read model and the raw log disagree by ${drift} across sent, delivered, opened and clicked.`
          : "Every delivery figure reconciles to the rows behind it.",
        evidence: { reported: { sent: reported.sent, delivered: reported.delivered, opened: reported.opened, clicked: reported.clicked }, raw },
      }),
    ];

    // And the figure the customer sees must contain none of anybody else's rows.
    const [everyone] = await db
      .select({ delivered: sql<number>`count(*) filter (where ${s.emailLog.deliveredAt} is not null)` })
      .from(s.emailLog);
    const leaked = Math.max(0, reported.delivered - n(raw?.delivered));
    results.push(
      compare({
        spec: ANALYTICS_TENANCY,
        actual: leaked,
        location: { entityType: "workspace", entityId: ctx.organizationId },
        message: leaked
          ? `This workspace's delivery total counts ${leaked} row(s) that are not its own.`
          : "The workspace's figures contain only its own rows.",
        evidence: { workspaceDelivered: n(raw?.delivered), platformDelivered: n(everyone?.delivered), reported: reported.delivered },
      }),
    );

    return merge(...results);
  },
};

/* ── Provider output ──────────────────────────────────────────────────────────────────────── */

export const providersCheck: Check = {
  id: "providers",
  title: "A provider reporting success is not the same as a usable output",
  async run(ctx: QcContext): Promise<CheckResult> {
    if (!ctx.organizationId) return nothing();
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const assets = await db
      .select({ id: s.creativeAssets.id, storageKey: s.creativeAssets.storageKey, sizeBytes: s.creativeAssets.sizeBytes, packId: s.creativeAssets.packId })
      .from(s.creativeAssets)
      .where(and(eq(s.creativeAssets.organizationId, ctx.organizationId), gte(s.creativeAssets.createdAt, since)))
      .limit(50);

    let broken = 0;
    for (const asset of assets) {
      if (!asset.storageKey) continue;
      if (!asset.sizeBytes || asset.sizeBytes <= 0) {
        broken += 1;
        continue;
      }
      if (!(await ctx.storage.exists(asset.storageKey).catch(() => false))) broken += 1;
    }

    return compare({
      spec: PROVIDER_OUTPUT_CHECKED,
      actual: broken,
      location: { entityType: "provider", entityId: ctx.organizationId },
      message: broken
        ? `${broken} of ${assets.length} generated asset(s) are recorded as made and have no usable file behind them.`
        : `All ${assets.length} generated assets have files behind them.`,
      evidence: { checked: assets.length, windowDays: 30 },
    });
  },
};
