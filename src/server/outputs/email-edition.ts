import type { EditionDocument } from "@/lib/publication/document";
import { blockText } from "@/lib/publication/document";
import { translator } from "@/lib/i18n";

/**
 * An edition, as an email.
 *
 * Email is not a small web page. There is no external stylesheet, no flexbox worth trusting, and no
 * second chance once it is in an inbox — so this renders tables with inline styles, one 600px
 * column, and absolute image URLs. Everything is escaped: article text comes from contributors.
 *
 * The email is a *digest*, not the whole magazine. It leads with the cover story and then lists
 * what is inside; the full text lives on the web edition, which is one link away. Sending 26
 * articles in one message would be clipped by Gmail at 102kB and read by nobody.
 */

export type EditionEmailOptions = {
  /** The organisation's name, shown above the masthead. */
  organizationName: string;
  logoUrl?: string | null;
  accentColour?: string | null;
  /** Where the full edition can be read, when a web output exists. */
  webUrl?: string | null;
  /** Per-recipient, and required: bulk mail without one is spam. */
  unsubscribeUrl: string;
  greetingName?: string | null;
  /** Absolute, long-lived image URLs by media id. */
  imageUrls: Record<string, string>;
  footerNote?: string | null;
  /** Hidden by the paid plans that remove Briefly's branding. */
  showBrieflyMark?: boolean;
  /** The publication's language — the one the reader agreed to receive. */
  locale?: string;
};

function esc(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** First paragraph, trimmed to something that reads as a summary rather than a truncation. */
function summarise(text: string, max = 180) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function standfirstFor(article: EditionDocument["articles"][number]) {
  if (article.standfirst) return article.standfirst;
  const firstParagraph = article.body.find((b) => b.type === "paragraph");
  return firstParagraph ? summarise(blockText(firstParagraph)) : "";
}

export function renderEditionEmail(doc: EditionDocument, options: EditionEmailOptions): { subject: string; html: string; text: string } {
  const t = translator(options.locale);
  const accent = options.accentColour || "#101014";
  const sections = new Map(doc.sections.map((s) => [s.id, s]));
  const byId = new Map(doc.articles.map((a) => [a.id, a]));

  const coverArticle = doc.meta.cover.articleId ? byId.get(doc.meta.cover.articleId) : undefined;
  const lead = coverArticle ?? doc.articles[0];
  const rest = doc.articles.filter((a) => a.id !== lead?.id);

  // Group what is left by section, in the order the flatplan puts them.
  const grouped: { name: string; colour: string | null; articles: typeof rest }[] = [];
  for (const article of rest) {
    const section = article.sectionId ? sections.get(article.sectionId) : undefined;
    const name = section?.name ?? t("editionEmail.alsoInThisEdition");
    const existing = grouped.find((g) => g.name === name);
    if (existing) existing.articles.push(article);
    else grouped.push({ name, colour: section?.colour ?? null, articles: [article] });
  }

  const subject = doc.meta.cover.headline || doc.meta.title;
  const preheader = lead ? standfirstFor(lead).slice(0, 140) : doc.meta.label;

  const heroUrl = doc.meta.cover.mediaId ? options.imageUrls[doc.meta.cover.mediaId] : lead?.heroMediaId ? options.imageUrls[lead.heroMediaId] : null;
  const readMore = (label: string) => (options.webUrl ? `<a href="${esc(options.webUrl)}" style="color:${esc(accent)};text-decoration:none;font-weight:600;">${esc(label)} →</a>` : "");

  const html = `<!doctype html>
<html lang="${esc(options.locale === "fr" ? "fr" : "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${esc(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f2;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:10px;overflow:hidden;">

  <tr><td style="padding:26px 30px 18px;text-align:center;border-bottom:1px solid #ececea;">
    ${options.logoUrl ? `<img src="${esc(options.logoUrl)}" alt="${esc(options.organizationName)}" height="28" style="height:28px;width:auto;display:block;margin:0 auto 12px;">` : ""}
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#8a8a85;">${esc(options.organizationName)}</div>
    <div style="margin-top:6px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.15;font-weight:700;color:#101014;">${esc(doc.meta.masthead.title)}</div>
    <div style="margin-top:6px;font-size:12px;color:#8a8a85;">${esc(doc.meta.issueLabel)} · ${esc(doc.meta.label)}</div>
  </td></tr>

  ${
    doc.meta.editorial
      ? `<tr><td style="padding:22px 30px 0;">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8a8a85;margin-bottom:8px;">${esc(t("editionEmail.fromTheEditor"))}</div>
    <p style="margin:0;font-size:15px;line-height:25px;color:#3a3a38;">${esc(summarise(doc.meta.editorial, 420))}</p>
  </td></tr>`
      : ""
  }

  ${
    lead
      ? `<tr><td style="padding:24px 30px 0;">
    ${heroUrl ? `<img src="${esc(heroUrl)}" alt="" width="540" style="width:100%;max-width:540px;height:auto;display:block;border-radius:6px;margin-bottom:16px;">` : ""}
    ${lead.kicker ? `<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${esc(accent)};font-weight:700;margin-bottom:6px;">${esc(lead.kicker)}</div>` : ""}
    <h1 style="margin:0 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.2;font-weight:700;color:#101014;">${esc(doc.meta.cover.headline || lead.headline)}</h1>
    <p style="margin:0 0 12px;font-size:16px;line-height:26px;color:#3a3a38;">${esc(doc.meta.cover.standfirst || standfirstFor(lead))}</p>
    ${lead.byline ? `<div style="font-size:12px;color:#8a8a85;margin-bottom:12px;">${esc(lead.byline)}</div>` : ""}
    ${readMore(t("editionEmail.readFullStory"))}
  </td></tr>`
      : ""
  }

  ${grouped
    .map(
      (group) => `<tr><td style="padding:26px 30px 0;">
    <div style="border-top:1px solid #ececea;padding-top:18px;">
      <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${esc(group.colour || "#8a8a85")};font-weight:700;margin-bottom:14px;">${esc(group.name)}</div>
      ${group.articles
        .map((article) => {
          const thumb = article.heroMediaId ? options.imageUrls[article.heroMediaId] : null;
          return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:18px;"><tr>
        ${thumb ? `<td width="88" valign="top" style="padding-right:14px;"><img src="${esc(thumb)}" alt="" width="88" style="width:88px;height:66px;object-fit:cover;display:block;border-radius:4px;"></td>` : ""}
        <td valign="top">
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.35;font-weight:700;color:#101014;margin-bottom:4px;">${esc(article.headline)}</div>
          <div style="font-size:14px;line-height:22px;color:#5a5a56;">${esc(summarise(standfirstFor(article), 150))}</div>
        </td>
      </tr></table>`;
        })
        .join("")}
    </div>
  </td></tr>`,
    )
    .join("")}

  ${
    options.webUrl
      ? `<tr><td style="padding:26px 30px 4px;text-align:center;">
    <a href="${esc(options.webUrl)}" style="display:inline-block;padding:13px 26px;border-radius:6px;background:${esc(accent)};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${esc(t("editionEmail.readWholeEdition"))}</a>
  </td></tr>`
      : ""
  }

  <tr><td style="padding:28px 30px 26px;text-align:center;">
    <div style="border-top:1px solid #ececea;padding-top:18px;font-size:12px;line-height:20px;color:#9a9a95;">
      ${options.footerNote ? `${esc(options.footerNote)}<br>` : ""}
      ${esc(t("editionEmail.whyReceiving", { publication: doc.meta.masthead.title }))}<br>
      <a href="${esc(options.unsubscribeUrl)}" style="color:#9a9a95;text-decoration:underline;">${esc(t("editionEmail.unsubscribe"))}</a>
      ${options.showBrieflyMark === false ? "" : ` · ${esc(t("subscribe.publishedWith", { brand: "Briefly" }))}`}
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    options.organizationName,
    `${doc.meta.masthead.title} — ${doc.meta.issueLabel}, ${doc.meta.label}`,
    "",
    doc.meta.editorial ? `${summarise(doc.meta.editorial, 420)}\n` : "",
    lead ? `${doc.meta.cover.headline || lead.headline}\n${doc.meta.cover.standfirst || standfirstFor(lead)}\n` : "",
    ...grouped.map((g) => [`${g.name.toUpperCase()}`, ...g.articles.map((a) => `- ${a.headline}: ${summarise(standfirstFor(a), 150)}`), ""].join("\n")),
    options.webUrl ? `${t("editionEmail.readWholeEdition")}: ${options.webUrl}` : "",
    "",
    `${t("editionEmail.unsubscribe")}: ${options.unsubscribeUrl}`,
  ]
    .filter(Boolean)
    .join("\n");

  return { subject, html, text };
}
