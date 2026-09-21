import { describe, expect, it } from "vitest";
import { renderEmailLayout, type EmailLayoutInput } from "@/server/email/template";

/**
 * Whose logo is at the top of a customer's email.
 *
 * It was Briefly's, on every message the platform sent: a contributor invited to write for a
 * newsletter opened an email headed by a product they had never heard of, with the publication's
 * own name nowhere above the fold. The words had already been fixed once; the layout had not, and
 * a layout is what somebody actually sees first.
 */
const base: EmailLayoutInput = {
  title: "Tell us what happened around you",
  blocks: [{ type: "paragraph", text: "We are putting the December issue together." }],
};

describe("the email masthead", () => {
  it("shows the publication's logo when the workspace has one", () => {
    const html = renderEmailLayout({ ...base, masthead: { name: "IA School Newsletter", logoUrl: "https://ia.school/logo.svg" } });
    expect(html).toContain('src="https://ia.school/logo.svg"');
    expect(html).toContain('alt="IA School Newsletter"');
  });

  it("shows the publication's own name and colour when it has no logo", () => {
    const html = renderEmailLayout({ ...base, masthead: { name: "IA School Newsletter", colour: "#0f766e" } });
    expect(html).toContain("IA School Newsletter");
    // `safeHex` normalises to upper case, which is valid CSS and not what is being tested here.
    expect(html.toLowerCase()).toContain("#0f766e");
    // The initial, not a stand-in mark borrowed from somewhere else.
    expect(html).toMatch(/>I<\/div>/);
  });

  it("never signs a customer's email with Briefly", () => {
    for (const masthead of [
      { name: "IA School Newsletter", logoUrl: "https://ia.school/logo.svg" },
      { name: "IA School Newsletter", colour: "#0f766e" },
      { name: "IA School Newsletter" },
    ]) {
      const html = renderEmailLayout({ ...base, masthead });
      expect(html, JSON.stringify(masthead)).not.toContain("Briefly");
      // The platform's own mark is two circles in its palette; neither belongs on this email.
      expect(html, JSON.stringify(masthead)).not.toContain("#2BAFE0;position:relative");
    }
  });

  it("signs off as the publication rather than as the tool", () => {
    const html = renderEmailLayout({ ...base, masthead: { name: "IA School Newsletter" } });
    expect(html).not.toContain(">Briefly<");
    const footer = html.slice(html.lastIndexOf("border-top:1px solid #f0f0ee"));
    expect(footer).toContain("IA School Newsletter");
  });

  it("keeps Briefly's own mark for the mail Briefly itself sends", () => {
    // A receipt, a domain to verify, a mailbox test: Briefly is the correspondent, not a workspace.
    const html = renderEmailLayout(base);
    expect(html).toContain("Briefly");
    expect(html).toContain("#2BAFE0;position:relative");
  });

  it("leaves a rendered edition alone, because it is already a whole document", () => {
    const html = renderEmailLayout({ ...base, rawHtml: "<html><body>the issue</body></html>", masthead: { name: "IA School Newsletter" } });
    expect(html).toBe("<html><body>the issue</body></html>");
  });

  it("escapes a name and a logo address rather than letting them into the markup", () => {
    const html = renderEmailLayout({ ...base, masthead: { name: '"><script>alert(1)</script>', logoUrl: '"><script>alert(1)</script>' } });
    expect(html).not.toContain("<script>");
  });
});
