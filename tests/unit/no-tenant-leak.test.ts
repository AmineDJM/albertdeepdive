import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { invitationEmail, reminderEmail } from "@/server/campaigns/emails";
import { DEFAULT_MASTHEAD } from "@/server/settings/schemas";

/**
 * No customer's name in anybody else's product.
 *
 * Briefly was built for one school and the name went in by hand: the invitation subject, the
 * kicker, the footer, the cover, every public contributor screen, the PDF colophon, and the system
 * prompt that told the model whose newspaper it was writing. A customer who created their own
 * newsletter watched it introduce itself to their contributors under somebody else's masthead.
 *
 * The scan is the guard. A test that only checked the email templates would pass the day somebody
 * writes a name into a new screen, and the reason this happened at all is that nothing was
 * watching the whole surface.
 */
const SOURCE = path.join(process.cwd(), "src");

/** Where the first customer legitimately still appears: its own seed data and the dev fixtures. */
const ALLOWED = [
  path.join("server", "db", "seed"),
  path.join("server", "dev", "simulate"),
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/** Strips comments, so an explanation of the fix does not read as the fix being undone. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("one customer's name never reaches another's newsletter", () => {
  it("is not written into any screen, template or prompt", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SOURCE)) {
      if (ALLOWED.some((allowed) => file.includes(allowed))) continue;
      const body = code(fs.readFileSync(file, "utf8"));
      // The string as it is written, and as JSX escapes an apostrophe.
      if (/Albert(&rsquo;|&apos;|')?s Deep Dive|Albert Deep Dive|Albert School/.test(body)) {
        offenders.push(path.relative(SOURCE, file));
      }
    }
    expect(offenders, `the first customer's name is still in: ${offenders.join(", ")}`).toEqual([]);
  });

  it("puts the newsletter's own name in the invitation a contributor reads", () => {
    const edition = { publicationName: "La Gazette du Nord", label: "March 2026", issueNumber: 4, publicationTargetAt: null };
    const campaign = { deadlineAt: new Date("2026-03-20T22:59:00Z"), graceEndsAt: new Date("2026-03-21T22:59:00Z"), introMessage: null };
    const message = invitationEmail({
      contributor: { firstName: "Amine", lastName: "D" },
      edition,
      campaign,
      link: "#",
      contactEmail: "hello@example.test",
    });
    expect(message.subject).toContain("La Gazette du Nord");
    expect(message.layout.kicker).toContain("La Gazette du Nord");
    expect(message.layout.footer).toContain("La Gazette du Nord");
    expect(JSON.stringify(message)).not.toMatch(/Albert/);
  });

  it("does the same for every reminder, which is where a leak would be loudest", () => {
    const edition = { publicationName: "Meridian Monthly", label: "May 2026", issueNumber: 9, publicationTargetAt: null };
    const campaign = { deadlineAt: new Date("2026-05-20T22:00:00Z"), graceEndsAt: new Date("2026-05-21T22:00:00Z") };
    for (const kind of ["REMINDER_1", "REMINDER_2", "GRACE_PERIOD"] as const) {
      const message = reminderEmail(kind, { contributor: { firstName: "Léa", lastName: "M" }, edition, campaign, link: "#", contactEmail: null });
      expect(JSON.stringify(message), kind).toContain("Meridian Monthly");
      expect(JSON.stringify(message), kind).not.toMatch(/Albert/);
    }
  });

  it("ships a workspace default that belongs to nobody in particular", () => {
    expect(DEFAULT_MASTHEAD.title).not.toMatch(/Albert/);
  });
});
