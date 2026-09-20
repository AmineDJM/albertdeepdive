import { html, join, raw, type Html } from "@/server/publication/templates/html";
import { compileBrandSystem, DEFAULT_BRAND_SYSTEM, type BrandSystem, type BrandTokens } from "@/lib/brand/system";
import { buildScale, type TypeScale } from "@/lib/design/type-scale";
import { blockFor, type DesignBlock, type DesignElement, type EditionDesign } from "@/lib/design/model";
import type { ResolvedDirection } from "@/lib/design/identity";
import type { PersonalityKey } from "@/lib/brand/typography";
import { IMPORTANCE_WEIGHT } from "@/lib/design/roles";
import { resolve, type ResolveContext } from "./content";

/**
 * The design, as an email — on email's own terms.
 *
 * §13 of the design brief: an email is not a web page with a narrower column. There is no external
 * stylesheet, no flexbox worth trusting, no second chance once it is in an inbox, and a message
 * past about 100 kB is cut in half by Gmail with a "view entire message" link where the last third
 * of the issue used to be.
 *
 * So this is a second renderer over the same design rather than a variant of the HTML one: tables,
 * inline styles, one fluid 600 px column, absolute image URLs, alt text that still reads when the
 * pictures are blocked, a button Outlook draws, and a dark mode that is a decision rather than an
 * inversion. What it shares with print and the web is everything that matters — the same design,
 * the same hierarchy, the same words — and what it changes, it changes because the medium is
 * genuinely different, not because it is a poor relation.
 *
 * One editorial decision is email's alone: it carries the issue's *openings*, not its body copy.
 * Twenty-six articles in one message is a message nobody reads and Gmail truncates. The whole text
 * is one link away, and the link is the point.
 */

/** The one width every client agrees on, and the gutter inside it. */
const WIDTH = 600;
const GUTTER = 28;

/** Gmail clips a message past roughly 102 kB. The tail is dropped on purpose before that happens. */
const DEFAULT_MAX_BYTES = 92_000;

export type EmailRenderOptions = {
  design: EditionDesign;
  direction: ResolvedDirection;
  content: ResolveContext;
  brand?: BrandSystem;
  personality?: PersonalityKey;
  locale?: string;
  /** The organisation above the masthead: readers subscribed to them, not to Briefly. */
  organizationName: string;
  logoUrl?: string | null;
  /** Where the whole edition can be read. Without it there is no "read the rest", and no point. */
  webUrl?: string | null;
  /** Per recipient, and required: bulk mail without one is spam. */
  unsubscribeUrl: string;
  greetingName?: string | null;
  footerNote?: string | null;
  showBrieflyMark?: boolean;
  maxBytes?: number;
};

export type RenderedEmail = {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  bytes: number;
  /** Blocks left out to stay under the clipping limit, so the count can be told honestly. */
  dropped: string[];
};

const WORDS: Record<string, Record<string, string>> = {
  en: {
    readStory: "Read the full story",
    readEdition: "Read the whole edition",
    more: "and {count} more in this edition",
    why: "You are receiving this because you subscribed to {title}.",
    unsubscribe: "Unsubscribe",
    inside: "Also in this edition",
    hello: "Hello {name},",
    with: "Published with Briefly",
  },
  fr: {
    readStory: "Lire l’article",
    readEdition: "Lire toute l’édition",
    more: "et {count} autres dans cette édition",
    why: "Vous recevez ce message parce que vous êtes abonné·e à {title}.",
    unsubscribe: "Se désabonner",
    inside: "Également dans cette édition",
    hello: "Bonjour {name},",
    with: "Publié avec Briefly",
  },
};

function words(locale: string | undefined) {
  const table = WORDS[(locale ?? "en").slice(0, 2).toLowerCase()] ?? WORDS.en;
  return (key: keyof (typeof WORDS)["en"], values: Record<string, string | number> = {}) =>
    Object.entries(values).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), table[key]);
}

/* ── Colour, in two schemes ──────────────────────────────────────────────────────────────── */

export type EmailPalette = {
  paper: string;
  ink: string;
  subdued: string;
  rule: string;
  highlight: string;
  /** The publication's own dark surface, not an inversion of its light one. */
  darkPaper: string;
  darkInk: string;
  darkSubdued: string;
  darkRule: string;
  darkHighlight: string;
  /** The page behind the 600 px column. */
  desk: string;
  darkDesk: string;
};

export function emailPalette(tokens: BrandTokens): EmailPalette {
  const light = tokens.surfaces.paper;
  const dark = tokens.surfaces.ink;
  return {
    paper: light.background,
    ink: light.foreground,
    subdued: light.subdued,
    rule: light.rule,
    highlight: light.highlight,
    darkPaper: dark.background,
    darkInk: dark.foreground,
    darkSubdued: dark.subdued,
    darkRule: dark.rule,
    darkHighlight: dark.highlight,
    desk: mixHex(light.background, light.foreground, 0.05),
    darkDesk: mixHex(dark.background, dark.foreground, 0.05),
  };
}

function mixHex(from: string, to: string, amount: number): string {
  const parse = (value: string) => {
    const hex = value.replace("#", "");
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex.slice(0, 6);
    const number = Number.parseInt(full, 16);
    return Number.isNaN(number) ? null : { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return from;
  const channel = (x: number, y: number) => Math.round(x + (y - x) * Math.min(1, Math.max(0, amount)));
  return `#${[channel(a.r, b.r), channel(a.g, b.g), channel(a.b, b.b)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/* ── Type, at inbox sizes ────────────────────────────────────────────────────────────────── */

/** What each role may grow to in an inbox. A display size that works on A3 is shouting on a phone. */
const EMAIL_CEILING: Record<string, number> = {
  "display-xl": 34,
  "display-l": 30,
  headline: 25,
  subheadline: 19,
  deck: 17,
  body: 16,
  "body-small": 15,
  caption: 13,
  metadata: 12,
  label: 11,
};

export function emailType(scale: TypeScale, role: keyof typeof EMAIL_CEILING, palette: EmailPalette, colour?: string): string {
  const style = scale.roles[role as keyof TypeScale["roles"]] ?? scale.roles.body;
  const size = Math.min(EMAIL_CEILING[role] ?? style.size, Math.round(style.size));
  const tracking = Math.round(style.tracking * size * 100) / 100;
  return [
    `margin:0`,
    // Every style here goes inside a double-quoted attribute, and a font stack carries quotes of
    // its own. Single quotes are the same CSS and do not end the attribute half way through.
    `font-family:${style.stack.replace(/"/g, "'")}`,
    `font-size:${size}px`,
    `line-height:${Math.round(size * style.leading)}px`,
    `font-weight:${style.weight}`,
    tracking ? `letter-spacing:${tracking}px` : "",
    style.case === "upper" ? "text-transform:uppercase" : "",
    `color:${colour ?? palette.ink}`,
    "-webkit-text-size-adjust:100%",
  ]
    .filter(Boolean)
    .join(";");
}

/* ── What email carries ──────────────────────────────────────────────────────────────────── */

/**
 * The elements an email draws.
 *
 * Body copy is not here, and that is the editorial decision rather than a technical limit: the
 * email is the issue's openings and the invitation to read it. Page numbers and datelines are
 * print's furniture and mean nothing in an inbox.
 */
const EMAIL_ELEMENTS = new Set([
  "headline",
  "subheadline",
  "kicker",
  "deck",
  "excerpt",
  "byline",
  "image",
  "quote",
  "attribution",
  "stat-value",
  "stat-label",
  "caption",
  "credit",
  "label",
  "link",
]);

/** The blocks that are the email's own furniture, and are therefore drawn by the email, not by the design. */
const FURNITURE = new Set(["masthead", "contents", "credits", "colophon", "footer", "page-number", "divider", "sponsor"]);

function elementsFor(block: DesignBlock, content: ResolveContext): DesignElement[] {
  // Resolved, not merely present. A deck element whose standfirst was never written draws nothing,
  // and an element that draws nothing must not be the one the email finds when it looks for a
  // summary — otherwise the story goes out as a headline with no invitation under it.
  const kept = block.elements.filter(
    (element) => EMAIL_ELEMENTS.has(element.role) && !element.omitIn.includes("email") && resolve(element.content, content).kind !== "nothing",
  );
  const hasSummary = kept.some((element) => ["deck", "excerpt", "quote"].includes(element.role));
  // A story with no standfirst still needs a line under the headline, and the document can produce
  // one: an opening trimmed at a sentence. A headline on its own is a link, not an invitation.
  if (!hasSummary && block.articleId && !FURNITURE.has(block.role)) {
    kept.push({
      id: `${block.id}-excerpt`,
      role: "excerpt",
      content: { kind: "article", articleId: block.articleId, part: "excerpt" },
      style: { type: "body" },
      constraints: { priority: 0.4 },
      omitIn: [],
    });
  }
  return kept;
}

/* ── The rows ────────────────────────────────────────────────────────────────────────────── */

type RowContext = {
  scale: TypeScale;
  palette: EmailPalette;
  content: ResolveContext;
  say: ReturnType<typeof words>;
  webUrl: string | null;
};

function textOf(element: DesignElement | undefined, ctx: RowContext): string | null {
  if (!element) return null;
  const resolved = resolve(element.content, ctx.content);
  return resolved.kind === "text" ? resolved.text : null;
}

function pictureOf(elements: DesignElement[], ctx: RowContext) {
  for (const element of elements.filter((candidate) => candidate.role === "image")) {
    const resolved = resolve(element.content, ctx.content);
    if (resolved.kind === "picture") return resolved;
  }
  return null;
}

function picture(url: string, alt: string, width: number, ctx: RowContext, radius = 4): Html {
  // Alt text is styled because a blocked image is the normal case, not the exception: a reader with
  // pictures off should meet a caption, not a broken frame.
  const style = `width:100%;max-width:${width}px;height:auto;display:block;border:0;outline:none;text-decoration:none;border-radius:${radius}px;${emailType(ctx.scale, "caption", ctx.palette, ctx.palette.subdued)}`;
  return html`<img src="${url}" alt="${alt}" width="${width}" class="fluid" style="${raw(style)}">`;
}

/** A button Outlook draws too, because a third of business readers are in Outlook. */
function button(url: string, label: string, ctx: RowContext): Html {
  const background = ctx.palette.highlight;
  const foreground = readableOn(background, ctx.palette);
  return raw(
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeAttribute(url)}" style="height:46px;v-text-anchor:middle;width:280px;" arcsize="10%" strokecolor="${background}" fillcolor="${background}">` +
      `<w:anchorlock/><center style="color:${foreground};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${escapeAttribute(label)}</center></v:roundrect><![endif]-->` +
      `<!--[if !mso]><!-- -->` +
      `<a href="${escapeAttribute(url)}" style="display:inline-block;padding:14px 28px;background:${background};color:${foreground};border-radius:6px;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;">${escapeAttribute(label)}</a>` +
      `<!--<![endif]-->`,
  );
}

function readableOn(background: string, palette: EmailPalette): string {
  const luminance = (hex: string) => {
    const value = hex.replace("#", "");
    const full = value.length === 3 ? [...value].map((c) => c + c).join("") : value.slice(0, 6);
    const number = Number.parseInt(full, 16);
    if (Number.isNaN(number)) return 0;
    const channels = [(number >> 16) & 255, (number >> 8) & 255, number & 255].map((channel) => {
      const ratio = channel / 255;
      return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  return luminance(background) > 0.45 ? palette.ink : palette.paper;
}

function escapeAttribute(value: string): string {
  return html`${value}`.value;
}

function cell(inner: Html, extra = ""): Html {
  return html`<tr><td class="pad" style="padding:0 ${GUTTER}px;${raw(extra)}">${inner}</td></tr>`;
}

/**
 * One block of the design, as a row of the email.
 *
 * The switch is by role and importance rather than by composition: a print composition is a set of
 * relationships in two dimensions, and an inbox has one. What survives the translation is the
 * hierarchy — how big, how much summary, how much picture — which is the part that carries meaning.
 */
function rowFor(block: DesignBlock, ctx: RowContext): Html | null {
  const elements = elementsFor(block, ctx.content);
  if (!elements.length) return null;
  const kicker = textOf(
    elements.find((element) => element.role === "kicker" || element.role === "label"),
    ctx,
  );
  const headline = textOf(
    elements.find((element) => element.role === "headline" || element.role === "subheadline"),
    ctx,
  );
  const summary = textOf(
    elements.find((element) => element.role === "deck" || element.role === "excerpt"),
    ctx,
  );
  const byline = textOf(
    elements.find((element) => element.role === "byline"),
    ctx,
  );
  const image = pictureOf(elements, ctx);
  const weight = IMPORTANCE_WEIGHT[block.importance];

  if (block.role === "quote" || block.role === "pull-quote") {
    const quote = textOf(
      elements.find((element) => element.role === "quote"),
      ctx,
    );
    if (!quote) return null;
    const attribution = textOf(
      elements.find((element) => element.role === "attribution"),
      ctx,
    );
    return cell(
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
        <td style="padding:18px 0 18px 18px;border-left:3px solid ${raw(ctx.palette.highlight)};">
          <p style="${raw(emailType(ctx.scale, "subheadline", ctx.palette))}">${quote}</p>
          ${attribution ? html`<p class="sub" style="${raw(emailType(ctx.scale, "metadata", ctx.palette, ctx.palette.subdued))};padding-top:8px;">${attribution}</p>` : ""}
        </td></tr></table>`,
      "padding-top:10px;padding-bottom:10px;",
    );
  }

  if (block.role === "stat" || block.role === "stat-group") {
    const value = textOf(
      elements.find((element) => element.role === "stat-value"),
      ctx,
    );
    const label = textOf(
      elements.find((element) => element.role === "stat-label"),
      ctx,
    );
    if (!value) return null;
    return cell(
      html`<p class="hl" style="${raw(emailType(ctx.scale, "display-l", ctx.palette, ctx.palette.highlight))}">${value}</p>${
        label ? html`<p class="sub" style="${raw(emailType(ctx.scale, "label", ctx.palette, ctx.palette.subdued))};padding-top:6px;">${label}</p>` : ""
      }`,
      "padding-top:14px;padding-bottom:14px;",
    );
  }

  if (block.role === "section-opener") {
    const name = headline ?? kicker;
    if (!name) return null;
    return cell(
      html`<p class="hl rule" style="${raw(emailType(ctx.scale, "label", ctx.palette, ctx.palette.highlight))};border-top:1px solid ${raw(ctx.palette.rule)};padding-top:18px;">${name}</p>`,
      "padding-top:12px;",
    );
  }

  if (["photo", "photo-pair", "photo-grid", "photo-spread", "portrait"].includes(block.role)) {
    const pictures = elements
      .filter((element) => element.role === "image")
      .map((element) => resolve(element.content, ctx.content))
      .filter((resolved): resolved is Extract<ReturnType<typeof resolve>, { kind: "picture" }> => resolved.kind === "picture");
    if (!pictures.length) return null;
    // Two across at most: three thumbnails in a 600 px column are three stamps.
    const cells = pictures.slice(0, 4).map((item) => html`<td class="col" width="50%" valign="top" style="padding:0 4px 8px;">${picture(item.url, item.alt || item.caption || "", 268, ctx)}</td>`);
    const rows: Html[] = [];
    for (let index = 0; index < cells.length; index += 2) rows.push(html`<tr>${join(cells.slice(index, index + 2))}</tr>`);
    return cell(
      html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${join(rows)}</table>`,
      "padding-top:12px;padding-bottom:6px;",
    );
  }

  if (!headline && !summary) return null;

  // A story. How much of it the email shows is the design's own hierarchy, read at inbox scale.
  const lead = weight >= IMPORTANCE_WEIGHT.LEAD;
  const major = weight >= IMPORTANCE_WEIGHT.MAJOR;
  const link = ctx.webUrl ? html`<p style="padding-top:12px;margin:0;"><a href="${ctx.webUrl}" style="${raw(emailType(ctx.scale, "label", ctx.palette, ctx.palette.highlight))};text-decoration:none;">${ctx.say("readStory")} →</a></p>` : html``;

  if (lead || major) {
    return cell(
      html`${image ? html`<div style="padding-bottom:16px;">${picture(image.url, image.alt || image.caption || "", WIDTH - GUTTER * 2, ctx, 6)}</div>` : ""}
        ${kicker ? html`<p class="hl" style="${raw(emailType(ctx.scale, "label", ctx.palette, ctx.palette.highlight))};padding-bottom:8px;">${kicker}</p>` : ""}
        ${headline ? html`<h2 style="${raw(emailType(ctx.scale, lead ? "headline" : "subheadline", ctx.palette))}">${headline}</h2>` : ""}
        ${summary ? html`<p class="sub" style="${raw(emailType(ctx.scale, "deck", ctx.palette, ctx.palette.subdued))};padding-top:10px;">${summary}</p>` : ""}
        ${byline ? html`<p class="sub" style="${raw(emailType(ctx.scale, "metadata", ctx.palette, ctx.palette.subdued))};padding-top:8px;">${byline}</p>` : ""}
        ${lead ? link : ""}`,
      "padding-top:22px;padding-bottom:6px;",
    );
  }

  // Everything else is a line in the list: a thumbnail, a headline and a sentence.
  return cell(
    html`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>
      ${image ? html`<td class="col" width="96" valign="top" style="padding:0 14px 0 0;">${picture(image.url, image.alt || "", 96, ctx)}</td>` : ""}
      <td class="col" valign="top">
        ${headline ? html`<p style="${raw(emailType(ctx.scale, "subheadline", ctx.palette))}">${headline}</p>` : ""}
        ${summary ? html`<p class="sub" style="${raw(emailType(ctx.scale, "body-small", ctx.palette, ctx.palette.subdued))};padding-top:6px;">${summary}</p>` : ""}
      </td></tr></table>`,
    "padding-top:16px;",
  );
}

/* ── The message ─────────────────────────────────────────────────────────────────────────── */

export function renderEmailEdition(options: EmailRenderOptions): RenderedEmail {
  const brand = options.brand ?? DEFAULT_BRAND_SYSTEM;
  const tokens = compileBrandSystem(brand);
  const palette = emailPalette(tokens);
  const scale = buildScale(options.direction, options.personality ?? brand.personality, "email");
  const say = words(options.locale);
  const content: ResolveContext = { ...options.content, medium: "email" };
  const ctx: RowContext = { scale, palette, content, say, webUrl: options.webUrl ?? null };
  const meta = content.document.meta;

  const blocks = options.design.sections
    .flatMap((section) => section.surfaces)
    .flatMap((surface) => surface.blocks)
    .map((block) => blockFor(block, "email"))
    .filter((block): block is DesignBlock => Boolean(block) && !FURNITURE.has(block!.role));

  const rows = blocks.map((block) => ({ block, row: rowFor(block, ctx) })).filter((entry): entry is { block: DesignBlock; row: Html } => Boolean(entry.row));

  const cover = blocks.find((block) => block.role === "cover") ?? blocks[0];
  const coverElements = cover ? elementsFor(cover, content) : [];
  const subject =
    textOf(
      coverElements.find((element) => element.role === "headline"),
      ctx,
    ) ||
    meta.cover.headline ||
    `${meta.masthead.title} — ${meta.issueLabel}`;
  const preheader =
    textOf(
      coverElements.find((element) => element.role === "deck" || element.role === "excerpt"),
      ctx,
    ) ||
    meta.cover.standfirst ||
    meta.label;

  // Built once at full length, then trimmed from the tail until it is under the clipping limit.
  const dropped: string[] = [];
  let kept = rows;
  let markup = assemble(kept, dropped.length, options, ctx, { subject, preheader });
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  while (Buffer.byteLength(markup, "utf8") > maxBytes && kept.length > 1) {
    dropped.push(kept[kept.length - 1].block.id);
    kept = kept.slice(0, -1);
    markup = assemble(kept, dropped.length, options, ctx, { subject, preheader });
  }

  return {
    subject,
    preheader,
    html: markup,
    text: plainText(kept.map((entry) => entry.block), dropped.length, options, ctx),
    bytes: Buffer.byteLength(markup, "utf8"),
    dropped,
  };
}

function assemble(
  rows: { block: DesignBlock; row: Html }[],
  droppedCount: number,
  options: EmailRenderOptions,
  ctx: RowContext,
  head: { subject: string; preheader: string },
): string {
  const { palette, scale, say } = ctx;
  const meta = ctx.content.document.meta;
  const locale = options.locale ?? "en";

  const masthead = html`<tr><td class="pad" style="padding:30px ${GUTTER}px 20px;text-align:center;border-bottom:1px solid ${raw(palette.rule)};">
    ${options.logoUrl ? html`<img src="${options.logoUrl}" alt="${options.organizationName}" height="28" style="height:28px;width:auto;display:block;margin:0 auto 12px;border:0;">` : ""}
    <p class="sub" style="${raw(emailType(scale, "label", palette, palette.subdued))}">${options.organizationName}</p>
    <p style="${raw(emailType(scale, "display-l", palette))};padding-top:6px;">${meta.masthead.title}</p>
    <p class="sub" style="${raw(emailType(scale, "metadata", palette, palette.subdued))};padding-top:8px;">${meta.issueLabel} · ${meta.label}</p>
  </td></tr>`;

  const greeting = options.greetingName
    ? html`<tr><td class="pad" style="padding:22px ${GUTTER}px 0;"><p style="${raw(emailType(scale, "body", palette))}">${say("hello", { name: options.greetingName })}</p></td></tr>`
    : html``;

  const more =
    droppedCount > 0
      ? html`<tr><td class="pad" style="padding:18px ${GUTTER}px 0;"><p class="sub" style="${raw(emailType(scale, "body-small", palette, palette.subdued))}">${say("more", { count: droppedCount })}</p></td></tr>`
      : html``;

  const cta = options.webUrl
    ? html`<tr><td class="pad" style="padding:28px ${GUTTER}px 8px;text-align:center;">${button(options.webUrl, say("readEdition"), ctx)}</td></tr>`
    : html``;

  const footer = html`<tr><td class="pad" style="padding:28px ${GUTTER}px 30px;text-align:center;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr><td style="border-top:1px solid ${raw(palette.rule)};padding-top:18px;">
      ${options.footerNote ? html`<p class="sub" style="${raw(emailType(scale, "metadata", palette, palette.subdued))};padding-bottom:6px;">${options.footerNote}</p>` : ""}
      <p class="sub" style="${raw(emailType(scale, "metadata", palette, palette.subdued))}">${say("why", { title: meta.masthead.title })}</p>
      <p class="sub" style="${raw(emailType(scale, "metadata", palette, palette.subdued))};padding-top:8px;">
        <a href="${options.unsubscribeUrl}" style="color:${raw(palette.subdued)};text-decoration:underline;">${say("unsubscribe")}</a>${
          options.showBrieflyMark === false ? "" : html` · ${say("with")}`
        }
      </p>
    </td></tr></table>
  </td></tr>`;

  return html`<!doctype html>
<html lang="${locale}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${head.subject}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
  table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;border-collapse:collapse;}
  img{-ms-interpolation-mode:bicubic;}
  @media (max-width:620px){
    .col{display:block !important;width:100% !important;max-width:100% !important;padding-right:0 !important;padding-bottom:12px !important;}
    .fluid{max-width:100% !important;width:100% !important;}
    .pad{padding-left:18px !important;padding-right:18px !important;}
  }
  @media (prefers-color-scheme:dark){
    .desk{background:${raw(palette.darkDesk)} !important;}
    .card{background:${raw(palette.darkPaper)} !important;}
    .card p,.card h2,.card td{color:${raw(palette.darkInk)} !important;}
    .card .sub{color:${raw(palette.darkSubdued)} !important;}
    .card .hl,.card a{color:${raw(palette.darkHighlight)} !important;}
    .rule,.card td[style*="border-top"]{border-color:${raw(palette.darkRule)} !important;}
  }
</style>
</head>
<body class="desk" style="margin:0;padding:0;background:${raw(palette.desk)};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${head.preheader}</div>
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="desk" style="background:${raw(palette.desk)};">
<tr><td align="center" style="padding:24px 10px;">
<!--[if mso]><table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" border="0" class="card" style="width:${WIDTH}px;max-width:100%;background:${raw(palette.paper)};border-radius:8px;">
${masthead}
${greeting}
${join(
  rows.map((entry) => entry.row),
  "\n",
)}
${more}
${cta}
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`.value;
}

/**
 * The plain-text alternative, from the same design.
 *
 * Not a fallback nobody reads: it is what a screen reader in text mode, a watch, and every spam
 * filter deciding whether this is a real message actually see.
 */
function plainText(blocks: DesignBlock[], droppedCount: number, options: EmailRenderOptions, ctx: RowContext): string {
  const meta = ctx.content.document.meta;
  const lines: string[] = [options.organizationName, `${meta.masthead.title} — ${meta.issueLabel}, ${meta.label}`, ""];
  if (options.greetingName) lines.push(ctx.say("hello", { name: options.greetingName }), "");

  for (const block of blocks) {
    const elements = elementsFor(block, ctx.content);
    const headline = textOf(
      elements.find((element) => element.role === "headline" || element.role === "subheadline"),
      ctx,
    );
    const summary = textOf(
      elements.find((element) => element.role === "deck" || element.role === "excerpt" || element.role === "quote"),
      ctx,
    );
    if (block.role === "section-opener") {
      const name = headline ?? textOf(elements.find((element) => element.role === "label"), ctx);
      if (name) lines.push("", name.toUpperCase(), "");
      continue;
    }
    if (!headline && !summary) continue;
    lines.push(headline ? `* ${headline}` : "*", summary ? `  ${summary}` : "");
  }

  if (droppedCount > 0) lines.push("", ctx.say("more", { count: droppedCount }));
  if (options.webUrl) lines.push("", `${ctx.say("readEdition")}: ${options.webUrl}`);
  lines.push("", ctx.say("why", { title: meta.masthead.title }), `${ctx.say("unsubscribe")}: ${options.unsubscribeUrl}`);
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
}
