/**
 * Minimal, polished transactional email layout (inline CSS, dark-mode safe, mobile first).
 */
export type EmailBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "callout"; title?: string; text: string }
  | { type: "kv"; rows: { label: string; value: string }[] }
  | { type: "divider" };

export type EmailLayoutInput = {
  preheader?: string;
  kicker?: string;
  title: string;
  blocks: EmailBlock[];
  cta?: { label: string; url: string };
  secondaryCta?: { label: string; url: string };
  footer?: string;
  appName?: string;
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

export function renderEmailLayout(input: EmailLayoutInput) {
  const app = input.appName ?? "Albert Deep Dive";
  const button = (cta: { label: string; url: string }, primary: boolean) =>
    `<a href="${esc(cta.url)}" style="display:inline-block;padding:11px 18px;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;${primary ? "background:#10203A;color:#ffffff;" : "background:#ffffff;color:#10203A;border:1px solid #d1d5db;"}margin-right:8px;">${esc(cta.label)}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(input.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
<tr><td style="padding:22px 28px 0;">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle;padding-right:10px;"><div style="width:22px;height:22px;border-radius:50%;background:#2BAFE0;position:relative;"><div style="position:absolute;left:-4px;top:7px;width:8px;height:8px;border-radius:50%;background:#10203A;"></div></div></td>
    <td style="vertical-align:middle;font-family:Georgia,'Times New Roman',serif;font-size:17px;letter-spacing:-.01em;color:#10203A;">${esc(app)}</td>
  </tr></table>
</td></tr>
<tr><td style="padding:22px 28px 8px;">
  ${input.kicker ? `<div style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#2BAFE0;font-weight:700;margin-bottom:8px;">${esc(input.kicker)}</div>` : ""}
  <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:30px;font-weight:600;color:#10203A;letter-spacing:-.01em;">${esc(input.title)}</h1>
  ${input.blocks.map(renderBlock).join("")}
  ${input.cta || input.secondaryCta ? `<div style="margin:20px 0 8px;">${input.cta ? button(input.cta, true) : ""}${input.secondaryCta ? button(input.secondaryCta, false) : ""}</div>` : ""}
  ${input.cta ? `<p style="margin:12px 0 0;font-size:12px;line-height:18px;color:#6b7280;">If the button does not work, copy this link: <a href="${esc(input.cta.url)}" style="color:#1F6FB2;word-break:break-all;">${esc(input.cta.url)}</a></p>` : ""}
</td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid #f0f0ee;font-size:12px;line-height:18px;color:#9ca3af;">${esc(input.footer ?? `${app} · the monthly newsroom of Albert School`)}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function emailTextFallback(input: EmailLayoutInput) {
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
