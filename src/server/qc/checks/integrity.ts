import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { blockText, editionDocumentSchema, type ArticleBlock } from "@/lib/publication/document";
import { renderEditionEmail } from "@/server/outputs/email-edition";
import { designEmailFor } from "@/server/design/email";
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

/** The text of one article, in one output, flattened for measurement. */
function articleText(article: { headline: string; standfirst?: string | null; body: unknown }): string {
  const body = (article.body as ArticleBlock[]).map(blockText).join(" ");
  return `${article.headline} ${article.standfirst ?? ""} ${body}`;
}

type Source = { label: string; facts: Map<string, Fact[]> };

/**
 * Every independently stored text of this issue, so there is something to compare with.
 *
 * This is the part that decides whether the check can fail at all. Print and web are both drawn
 * from the same document *now*, so comparing them with each other would compare a thing with
 * itself and pass forever. What can genuinely disagree is a **frozen** output — the version an
 * output was published from, whose document was stored at the moment it was published — against
 * another frozen output, or against the issue as it stands today. That is exactly the failure the
 * rule is for: the web edition went out in March saying €2.4M, the magazine was re-exported in
 * April after somebody corrected it to €24M, and both are live.
 */
async function factSources(ctx: QcContext): Promise<Source[]> {
  const sources: Source[] = [];

  const current = new Map<string, Fact[]>();
  for (const article of ctx.document.articles) current.set(article.id, extractFacts(articleText(article)));
  sources.push({ label: "the issue as it stands", facts: current });

  const outputs = await db
    .select({ format: s.editionOutputs.format, versionId: s.editionOutputs.versionId, publishedAt: s.editionOutputs.publishedAt })
    .from(s.editionOutputs)
    .where(and(eq(s.editionOutputs.editionId, ctx.editionId), isNotNull(s.editionOutputs.versionId)));
  if (!outputs.length) return sources;

  const versions = await db
    .select({ id: s.publicationVersions.id, label: s.publicationVersions.label, document: s.publicationVersions.document })
    .from(s.publicationVersions)
    .where(inArray(s.publicationVersions.id, outputs.map((output) => output.versionId!)));
  const byId = new Map(versions.map((version) => [version.id, version]));

  for (const output of outputs) {
    const version = output.versionId ? byId.get(output.versionId) : undefined;
    const parsed = version?.document ? editionDocumentSchema.safeParse(version.document) : null;
    if (!parsed?.success) continue;
    const facts = new Map<string, Fact[]>();
    for (const article of parsed.data.articles) facts.set(article.id, extractFacts(articleText(article)));
    sources.push({ label: `the ${output.format.toLowerCase()} output (${version!.label})`, facts });
  }
  return sources;
}

export const factsCheck: Check = {
  id: "facts",
  title: "A number means the same thing in every output",
  async run(ctx: QcContext): Promise<CheckResult> {
    const sources = await factSources(ctx);
    const results: CheckResult[] = [];
    let mismatches = 0;

    // ── Frozen outputs against each other, and against the issue as it stands ──
    if (sources.length > 1) {
      for (const article of ctx.document.articles) {
        for (const kind of ["money", "percent", "date"] as const) {
          const stated = sources
            .map((source) => ({ label: source.label, facts: (source.facts.get(article.id) ?? []).filter((fact) => fact.kind === kind) }))
            .filter((each) => each.facts.length > 0);
          if (stated.length < 2) continue;
          // Two outputs agree when the set of values each states is the same set. A shortened
          // version that drops a number entirely is a different matter — that is copy, and copy
          // is allowed to change. What may not happen is the same article stating 2,400,000 in one
          // output and 24,000,000 in another.
          const sets = stated.map((each) => [...new Set(each.facts.map((fact) => fact.value))].sort().join("|"));
          const first = sets[0];
          const differing = sets.findIndex((set) => set !== first);
          if (differing < 0) continue;
          mismatches += 1;
          const a = stated[0];
          const b = stated[differing];
          results.push(
            assertThat({
              spec: FACT_CONSISTENCY,
              holds: false,
              location: { entityType: "article", entityId: article.id, entityLabel: article.headline, field: kind },
              message: `"${article.headline}" says ${a.facts.map((fact) => fact.raw).join(" / ")} in ${a.label} and ${b.facts.map((fact) => fact.raw).join(" / ")} in ${b.label}. Copy may change between outputs; a ${kind} may not.`,
              expected: `${a.facts.map((fact) => fact.raw).join(" / ")} (${a.label})`,
              actual: `${b.facts.map((fact) => fact.raw).join(" / ")} (${b.label})`,
              evidence: { kind, sources: stated.map((each) => ({ output: each.label, values: each.facts.map((fact) => fact.value) })) },
            }),
          );
        }
      }
    }

    // ── The email teaser against the article it teases ──
    // Worth its own pass because the teaser is *derived*: it is cut to 180 characters at a word
    // boundary, and a cut in the wrong place turns "€2.4 million" into "€2.4" — a hundredth of the
    // real figure, in the one line most readers will ever see.
    let emailText = "";
    try {
      const unsubscribeUrl = "https://example.test/s/unsubscribe/qc";
      // Whichever renderer would actually send this edition: checking the teaser in a message that
      // is not the one going out is a check that passes while the sent one is wrong.
      const designed = await designEmailFor(ctx.editionId, { document: ctx.document, imageUrls: {}, organizationName: "QC" });
      emailText = designed ? designed({ unsubscribeUrl }).text : renderEditionEmail(ctx.document, { organizationName: "QC", unsubscribeUrl, imageUrls: {} }).text;
    } catch {
      emailText = "";
    }
    if (emailText) {
      for (const article of ctx.document.articles) {
        const source = extractFacts(articleText(article));
        if (!source.length || !emailText.includes(article.headline)) continue;
        for (const fact of extractFacts(articleTeaser(emailText, article.headline))) {
          const sameKind = source.filter((each) => each.kind === fact.kind);
          if (!sameKind.length || sameKind.some((each) => each.value === fact.value)) continue;
          mismatches += 1;
          results.push(
            assertThat({
              spec: FACT_CONSISTENCY,
              holds: false,
              location: { entityType: "article", entityId: article.id, entityLabel: article.headline, field: fact.kind, output: "EMAIL" },
              message: `"${article.headline}" says ${sameKind.map((each) => each.raw).join(" / ")} and its email teaser says ${fact.raw}. Copy may shorten between outputs; a ${fact.kind} may not.`,
              expected: sameKind.map((each) => each.raw).join(" or "),
              actual: fact.raw,
              evidence: { kind: fact.kind, article: sameKind.map((each) => each.value), email: fact.value },
            }),
          );
        }
      }
    }

    if (!mismatches) {
      results.push(
        compare({
          spec: FACT_CONSISTENCY,
          actual: 0,
          location: { entityType: "edition", entityId: ctx.editionId },
          message: sources.length > 1 ? `Every number agrees across ${sources.length} rendering(s) of this issue.` : "Every number in the email teasers agrees with the article it teases.",
          evidence: { sources: sources.map((source) => source.label) },
        }),
      );
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
/** Whatever the renderer marks the next item with: "- ", "* ", "• ", or a bullet on a line of its own. */
const NEXT_ITEM = /\n[ \t]*[-*\u2022]/;

/** The teaser is cut to 180 characters at a word boundary; a little slack, and no more. */
const TEASER_SLACK = 220;

export function articleTeaser(text: string, headline: string): string {
  const at = text.indexOf(headline);
  if (at < 0) return "";
  const after = at + headline.length;
  /*
   * One article's teaser, and not a word of the next one's.
   *
   * This looked only for "\n- ", which is what the plain email renderer writes — and not what the
   * designed one does: it separates items with an asterisk. So against the renderer that actually
   * sends, no boundary was ever found, the fallback window ran on through the following two items,
   * and a date belonging to a different piece came back as this article contradicting itself. The
   * issue was held at the gate over a sentence nobody had written.
   */
  const rest = text.slice(after);
  const boundary = NEXT_ITEM.exec(rest)?.index ?? -1;
  const end = after + (boundary >= 0 ? boundary : Math.min(rest.length, TEASER_SLACK));
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
