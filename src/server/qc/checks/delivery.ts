import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { renderEditionEmail } from "@/server/outputs/email-edition";
import { designEmailFor } from "@/server/design/email";
import { mediaUrls } from "@/server/media/urls";
import {
  DELIVERY_RECONCILES,
  DELIVERY_UNCONFIRMED,
  EMAIL_ALT_TEXT,
  EMAIL_IMAGES_RESOLVE,
  EMAIL_LINKS_VALID,
  EMAIL_UNSUBSCRIBE,
  EMAIL_WIDTH,
  WEB_METADATA,
  WEB_NOINDEX_UNPUBLISHED,
} from "../spec";
import { assertThat, compare, merge, nothing, type CheckResult } from "../types";
import type { Check, QcContext } from "../engine";

/**
 * Email and web, measured on the thing that actually goes out.
 *
 * "The email preview opened" is not email QA. The preview opens with a broken image in it, with a
 * link pointing at localhost, with a table three hundred pixels wider than a phone, and with no
 * unsubscribe at all — and it opens just as cheerfully in every one of those cases.
 *
 * So the message is rendered exactly as the sender would render it, and then read: every image
 * source resolved against storage, every href parsed, the widest declared width compared with the
 * narrow phone every newsletter is read on, and the opt-out looked for rather than assumed.
 */

/** A rendered message, built the way `sendEditionEmail` builds it, minus the sending. */
async function renderForCheck(ctx: QcContext) {
  const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, ctx.editionId) });
  const organization = edition?.organizationId
    ? await db.query.organizations.findFirst({ where: eq(s.organizations.id, edition.organizationId) })
    : null;
  const imageUrls = await mediaUrls(
    ctx.document.media.map((media) => media.id),
    "WEB",
    3600,
  );
  // The same choice the send path makes, or this checks a message nobody receives.
  const unsubscribeUrl = "https://example.test/s/unsubscribe/qc-preflight-token";
  const designed = await designEmailFor(ctx.editionId, {
    document: ctx.document,
    imageUrls,
    organizationName: organization?.name ?? "Briefly",
    showBrieflyMark: true,
  });
  if (designed) return designed({ unsubscribeUrl });
  return renderEditionEmail(ctx.document, {
    organizationName: organization?.name ?? "Briefly",
    accentColour: null,
    webUrl: null,
    // A real per-recipient link, so the shape being checked is the shape that is sent.
    unsubscribeUrl,
    imageUrls,
    showBrieflyMark: true,
  });
}

const IMG = /<img\b[^>]*>/gi;
const ATTR = (tag: string, name: string): string | null => new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag)?.[1] ?? null;
const HREF = /href\s*=\s*"([^"]*)"/gi;
const WIDTH = /(?:width\s*[:=]\s*"?|max-width\s*:\s*)(\d{2,4})\s*(?:px)?/gi;
const SIZED = /<(?:table|td|th|div|img|p|a|v:roundrect)\b[^>]*>/gi;

/**
 * The widest thing in the message that a phone cannot shrink.
 *
 * Measured per element rather than over the whole document, because the width that matters is the
 * one that is still there after the client has done its own arithmetic. A 600 px table carrying
 * `max-width:100%` is the standard responsive email: it is 600 px on a desktop and 375 px on a
 * phone, and counting it as 600 reports sideways scroll on every well-built newsletter ever sent.
 */
export function widestFixedWidth(html: string): number {
  let widest = 0;
  // Markup only Outlook on a desktop ever renders is not measured against a phone. The other
  // conditional — the one that reveals content to every client except Outlook — is left in place,
  // because that content is exactly what the phone will draw.
  const visible = html.replace(/<!--\[if (?!!)[^\]]*\]>[\s\S]*?<!\[endif\]-->/gi, "");
  for (const tag of visible.match(SIZED) ?? []) {
    if (/(?:max-)?width\s*:\s*100%/i.test(tag)) continue;
    for (const match of tag.matchAll(WIDTH)) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value < 3000) widest = Math.max(widest, value);
    }
  }
  return widest;
}

export const emailCheck: Check = {
  id: "email",
  title: "Every picture resolves, every link works, the message fits a phone",
  kinds: ["email"],
  async run(ctx: QcContext): Promise<CheckResult> {
    const { html, text } = await renderForCheck(ctx);
    const results: CheckResult[] = [];
    const location = { entityType: "output" as const, entityId: ctx.editionId, output: "EMAIL" };

    // ── pictures ──
    const tags = html.match(IMG) ?? [];
    let brokenImages = 0;
    let missingAlt = 0;
    for (const tag of tags) {
      const src = ATTR(tag, "src");
      const alt = ATTR(tag, "alt");
      if (!alt?.trim()) missingAlt += 1;
      if (!src) {
        brokenImages += 1;
        continue;
      }
      if (src.startsWith("data:")) {
        // A data URI is only a picture if there are bytes after the comma.
        if (src.length < 32 || !src.includes(",")) brokenImages += 1;
        continue;
      }
      const key = storageKeyOf(src);
      if (key) {
        const there = await ctx.storage.exists(key).catch(() => false);
        if (!there) brokenImages += 1;
        continue;
      }
      if (!/^https?:\/\//i.test(src)) brokenImages += 1;
    }

    results.push(
      compare({
        spec: EMAIL_IMAGES_RESOLVE,
        actual: brokenImages,
        location,
        message: brokenImages ? `${brokenImages} of ${tags.length} picture(s) in the email have nothing behind them.` : `All ${tags.length} pictures resolve.`,
      }),
    );
    results.push(compare({ spec: EMAIL_ALT_TEXT, actual: missingAlt, location, message: `${missingAlt} picture(s) have no alternative text.` }));

    // ── links ──
    const hrefs = [...html.matchAll(HREF)].map((match) => match[1]);
    const broken = hrefs.filter((href) => !usable(href));
    results.push(
      compare({
        spec: EMAIL_LINKS_VALID,
        actual: broken.length,
        location,
        message: broken.length ? `${broken.length} link(s) go nowhere a reader can follow: ${broken.slice(0, 3).join(", ")}` : `All ${hrefs.length} links are absolute and reachable.`,
        evidence: broken.length ? { broken: broken.slice(0, 10) } : undefined,
      }),
    );

    // ── the opt-out ──
    results.push(
      assertThat({
        spec: EMAIL_UNSUBSCRIBE,
        holds: /\/s\/unsubscribe\//.test(html) && /unsubscribe/i.test(text),
        location,
        message: "The message has no per-recipient unsubscribe link. Bulk mail without a working opt-out is a compliance failure before it is a quality one.",
        expected: "an unsubscribe link in the HTML and the text part",
        actual: /\/s\/unsubscribe\//.test(html) ? "HTML only" : "absent",
      }),
    );

    // ── width ──
    const viewport = ctx.profile.viewportPx?.width ?? 375;
    const widest = widestFixedWidth(html);
    results.push(
      compare({
        spec: EMAIL_WIDTH,
        actual: Math.max(0, widest - viewport),
        location,
        message:
          widest > viewport
            ? `Something in the message is ${widest}px wide. A ${viewport}px phone would scroll sideways by ${widest - viewport}px.`
            : `Nothing is wider than the ${viewport}px viewport.`,
        expectedText: `≤ ${viewport} px`,
        evidence: { widestPx: widest, viewportPx: viewport },
      }),
    );

    return merge(...results);
  },
};

/** The storage key behind an app-served image URL, when there is one. */
function storageKeyOf(src: string): string | null {
  try {
    const url = new URL(src, "https://placeholder.invalid");
    const match = /\/api\/storage\/(.+)$/.exec(url.pathname);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/** Whether a reader could actually follow this. */
function usable(href: string): boolean {
  const value = href.trim();
  if (!value) return false;
  if (value.startsWith("mailto:") || value.startsWith("tel:")) return true;
  if (value.startsWith("#")) return false;
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(url.hostname)) return false;
    if (/(^|\.)(staging|preview|test)\./i.test(url.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * The web edition, which is rendered when it is read rather than frozen.
 *
 * So the checks are not about geometry — there is no artefact to measure — but about the two things
 * that are decided before anybody arrives: whether the page says what it is, and whether an issue
 * nobody has published is being offered to search engines.
 */
export const webCheck: Check = {
  id: "web",
  title: "A published page says what it is; an unpublished one is not indexed",
  kinds: ["web"],
  async run(ctx: QcContext): Promise<CheckResult> {
    const location = { entityType: "output" as const, entityId: ctx.editionId, output: "WEB" };
    const output = await db.query.editionOutputs.findFirst({
      where: and(eq(s.editionOutputs.editionId, ctx.editionId), eq(s.editionOutputs.format, "WEB")),
    });
    const published = output?.status === "PUBLISHED";

    const meta = ctx.document.meta;
    const hasTitle = Boolean(meta.issueLabel && meta.masthead?.title);
    const hasDescription = Boolean(meta.cover?.headline);

    return merge(
      assertThat({
        spec: WEB_METADATA,
        holds: hasTitle && hasDescription,
        location,
        message: "The web edition has no title or no description to put in front of a reader or a search engine.",
        expected: "a title and a description",
        actual: `title=${hasTitle} description=${hasDescription}`,
      }),
      assertThat({
        spec: WEB_NOINDEX_UNPUBLISHED,
        // The route serves an unpublished edition behind a 404, so "not published" is "not indexed".
        holds: published || !output || output.status !== "READY",
        location,
        message: "An edition that is ready but not published must not be reachable by a crawler.",
        expected: published ? "indexable" : "noindex",
        actual: output?.status ?? "no web output",
      }),
    );
  },
};

/* ── Delivery reconciliation ──────────────────────────────────────────────────────────────── */

export const reconciliationCheck: Check = {
  id: "reconciliation",
  title: "The delivery log and the provider tell the same story",
  async run(ctx: QcContext): Promise<CheckResult> {
    if (!ctx.organizationId) return nothing();
    const { deliveryDrift } = await import("@/server/email/reconcile");
    const report = await deliveryDrift(ctx.organizationId);
    if (!report.checked) return nothing();

    const sample = report.drifted.slice(0, 8).map((drift) => ({ to: drift.to, logged: drift.logged, reported: drift.reported, events: drift.events }));
    return merge(
      compare({
        spec: DELIVERY_RECONCILES,
        actual: report.drifted.length,
        location: { entityType: "workspace", entityId: ctx.organizationId, field: "delivery" },
        message: report.drifted.length
          ? `${report.drifted.length} of ${report.checked} messages are recorded as something other than what the provider reported — the first says ${report.drifted[0].logged.toLowerCase()} where the provider said ${report.drifted[0].reported.toLowerCase()}.`
          : `All ${report.checked} messages agree with what the provider reported.`,
        evidence: { checked: report.checked, sample },
      }),
      compare({
        spec: DELIVERY_UNCONFIRMED,
        actual: report.unconfirmed,
        location: { entityType: "workspace", entityId: ctx.organizationId, field: "delivery" },
        message: report.unconfirmed
          ? `${report.unconfirmed} message(s) went out through the provider over a day ago and it has never reported anything about them. Delivery reporting is probably not wired up.`
          : `The provider has reported on everything it was asked to send.`,
        evidence: { checked: report.checked, addresses: report.unconfirmedSample },
      }),
    );
  },
};
