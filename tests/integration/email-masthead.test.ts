import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { resolveMasthead } from "@/server/email/masthead";
import { renderEmailLayout } from "@/server/email/template";
import { previewInvitation } from "@/server/campaigns/preview";
import { runAsOrganization } from "@/server/tenancy/context";

/**
 * The masthead on the real path, not on a hand-built layout.
 *
 * The unit test proves the renderer does the right thing when told who is writing. This proves it
 * is told — that a send which names only an edition still comes out signed by that edition's
 * newsletter, wearing that workspace's logo, because that is the call every customer-facing email
 * actually makes.
 */
describe("who signs a customer's email", () => {
  let editionId: string;
  let organizationId: string;
  let publicationName: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
    const publication = await db.query.publications.findFirst({ where: eq(s.publications.id, edition!.publicationId!) });
    publicationName = publication!.name;
    await db.update(s.organizations).set({ logoUrl: "https://albertschool.com/logo.svg", brandColours: { primary: "#0F766E" } }).where(eq(s.organizations.id, organizationId));
  }, 300_000);

  it("works the sender out from an edition alone", async () => {
    const masthead = await resolveMasthead({ editionId });
    expect(masthead).toMatchObject({ name: publicationName, logoUrl: "https://albertschool.com/logo.svg", colour: "#0F766E" });
  });

  it("falls back to the workspace when the email is not about one publication", async () => {
    const masthead = await resolveMasthead({ organizationId });
    expect(masthead?.name).toBe("Albert School");
    expect(masthead?.logoUrl).toBe("https://albertschool.com/logo.svg");
  });

  it("says nothing belongs to a workspace when nothing does", async () => {
    expect(await resolveMasthead({})).toBeNull();
  });

  it("puts the newsletter's logo on the invitation a contributor would open", async () => {
    const preview = await runAsOrganization(organizationId, () => previewInvitation(editionId));
    expect(preview.html).toContain("https://albertschool.com/logo.svg");
    expect(preview.html).toContain(publicationName);
    // The header is the customer's. Briefly's name belongs in the product, not on their mail.
    expect(preview.html.slice(0, preview.html.indexOf("</h1>"))).not.toContain("Briefly");
  });

  it("renders the same masthead the send would use", async () => {
    const masthead = await resolveMasthead({ editionId });
    const html = renderEmailLayout({ title: "Anything", blocks: [], masthead });
    expect(html).toContain("https://albertschool.com/logo.svg");
    expect(html).not.toContain("#2BAFE0;position:relative");
  });
});
