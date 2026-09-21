/**
 * Minimal, polished transactional email layout (inline CSS, dark-mode safe, mobile first).
 *
 * The mark at the top belongs to whoever is writing. That used to be Briefly's, drawn in CSS and
 * hardcoded, on every email the platform sent — which meant a contributor invited to write for
 * somebody's newsletter opened a message topped by the logo of a product they have never heard of,
 * and the customer's own name appeared nowhere above the fold. A newsletter is its own publication;
 * the invitation to write for it is from *it*, not from the tool it was built with.
 *
 * So the masthead is the sender's: their logo when the workspace has one, their name in their own
 * colour when it does not. Briefly's mark is kept for the emails Briefly itself sends — a receipt,
 * a domain to verify, a mailbox test — which is the only correspondence it is a party to.
 */
import { isLight, safeHex } from "@/lib/brand/colour";

export type EmailBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "callout"; title?: string; text: string }
  | { type: "kv"; rows: { label: string; value: string }[] }
  | { type: "divider" };

/** Who this email is from, as the reader sees it at the top of the message. */
export type EmailMasthead = {
  name: string;
  logoUrl?: string | null;
  /** The workspace's own colour, for the lettered mark shown when there is no logo. */
  colour?: string | null;
};

export type EmailLayoutInput = {
  preheader?: string;
  kicker?: string;
  title: string;
  blocks: EmailBlock[];
  cta?: { label: string; url: string };
  secondaryCta?: { label: string; url: string };
  footer?: string;
  /**
   * The publication or workspace writing. Absent means Briefly is writing on its own behalf, which
   * is true of billing, domain setup and mailbox tests, and of nothing a reader or contributor gets.
   */
  masthead?: EmailMasthead | null;
  appName?: string;
  /**
   * A message that is already a complete document — a rendered edition, say. Wrapping it in the
   * transactional layout would nest one <html> inside another, which mail clients render badly.
   */
  rawHtml?: string;
  rawText?: string;
};

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderBlock(b: EmailBlock): string {
  switch (b.type) {
    case "paragraph":
      return `<p style="margin:0 0 14px;font-size:15px;line-height:24px;color:#1f2937;">${esc(b.text)}</p>`;
    case "list":
      return `<ul style="margin:0 0 14px;padding-left:20px;font-size:15px;line-height:24px;color:#1f2937;">${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
    case "callout":
      return `<div style="margin:0 0 16px;padding:14px 16px;border-left:3px solid #2BAFE0;background:#f3f9fd;border-radius:4px;">${b.title ? `<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#10203A;font-weight:600;margin-bottom:4px;">${esc(b.title)}</div>` : ""}<div style="font-size:14px;line-height:22px;color:#1f2937;">${esc(b.text)}</div></div>`;
    case "kv":
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;width:100%;font-size:14px;line-height:22px;">${b.rows.map((r) => `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${esc(r.label)}</td><td style="padding:4px 0;color:#111827;">${esc(r.value)}</td></tr>`).join("")}</table>`;
    case "divider":
      return `<hr style="border:0;border-top:1px solid #e5e7eb;margin:20px 0;" />`;
  }
}

/** Briefly's own mark, drawn in CSS so it needs no image an inbox might block. */
function brieflyMark(app: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;"><div style="width:22px;height:22px;border-radius:50%;background:#2BAFE0;position:relative;"><div style="position:absolute;left:-4px;top:7px;width:8px;height:8px;border-radius:50%;background:#10203A;"></div></div></td>
    <td style="vertical-align:middle;font-family:Georgia,'Times New Roman',serif;font-size:17px;letter-spacing:-.01em;color:#10203A;">${esc(app)}</td>
  </tr></table>`;
}

/**
 * The sender's masthead.
 *
 * A logo when the workspace has one — an image, because that is what a logo is, and an inbox that
 * blocks it still shows the name in the `alt`. Otherwise the publication's initial in its own
 * colour, which is a real mark rather than a placeholder: it is the same letter every month, and
 * it is never somebody else's.
 */
function mastheadRow(brand: EmailMasthead): string {
  const name = brand.name.trim() || "Newsletter";
  if (brand.logoUrl) {
    return `<img src="${esc(brand.logoUrl)}" alt="${esc(name)}" height="28" style="height:28px;width:auto;max-width:220px;display:block;border:0;" />`;
  }
  const colour = safeHex(brand.colour ?? null, "#10203A");
  const ink = isLight(colour) ? "#10203A" : "#ffffff";
  const initial = esc([...name][0]?.toUpperCase() ?? "N");
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;"><div style="width:26px;height:26px;border-radius:50%;background:${colour};color:${ink};font-family:Georgia,'Times New Roman',serif;font-size:14px;line-height:26px;text-align:center;font-weight:600;">${initial}</div></td>
    <td style="vertical-align:middle;font-family:Georgia,'Times New Roman',serif;font-size:17px;letter-spacing:-.01em;color:#10203A;">${esc(name)}</td>
  </tr></table>`;
}

export function renderEmailLayout(input: EmailLayoutInput) {
  if (input.rawHtml) return input.rawHtml;
  const app = input.appName ?? "Briefly";
  const header = input.masthead ? mastheadRow(input.masthead) : brieflyMark(app);
  // The footer signs off as whoever wrote, for the same reason the header does.
  const signature = input.footer ?? input.masthead?.name ?? app;
  const button = (cta: { label: string; url: string }, primary: boolean) =>
    `<a href="${esc(cta.url)}" style="display:inline-block;padding:11px 18px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;${primary ? "background:#10203A;color:#ffffff;" : "background:#ffffff;color:#10203A;border:1px solid #d1d5db;"}margin-right:8px;">${esc(cta.label)}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(input.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:22px 28px 0;">${header}</td></tr>
<tr><td style="padding:22px 28px 8px;">
  ${input.kicker ? `<div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#2BAFE0;font-weight:700;margin-bottom:8px;">${esc(input.kicker)}</div>` : ""}
  <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:600;color:#10203A;letter-spacing:-.01em;">${esc(input.title)}</h1>
  ${input.blocks.map(renderBlock).join("")}
  ${input.cta || input.secondaryCta ? `<div style="margin:20px 0 8px;">${input.cta ? button(input.cta, true) : ""}${input.secondaryCta ? button(input.secondaryCta, false) : ""}</div>` : ""}
  ${input.cta ? `<p style="margin:12px 0 0;font-size:12px;line-height:18px;color:#6b7280;">If the button does not work, copy this link: <a href="${esc(input.cta.url)}" style="color:#1F6FB2;word-break:break-all;">${esc(input.cta.url)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid #f0f0ee;font-size:12px;line-height:18px;color:#9ca3af;">${esc(signature)}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function emailTextFallback(input: EmailLayoutInput) {
  if (input.rawText) return input.rawText;
  const lines: string[] = [input.title, ""];
  for (const b of input.blocks) {
    if (b.type === "paragraph") lines.push(b.text, "");
    if (b.type === "list") lines.push(...b.items.map((i) => `• ${i}`), "");
    if (b.type === "callout") lines.push(`${b.title ? b.title + ": " : ""}${b.text}`, "");
    if (b.type === "kv") lines.push(...b.rows.map((r) => `${r.label}: ${r.value}`), "");
  }
  if (input.cta) lines.push(`${input.cta.label}: ${input.cta.url}`);
  if (input.secondaryCta) lines.push(`${input.secondaryCta.label}: ${input.secondaryCta.url}`);
  return lines.join("\n");
}
