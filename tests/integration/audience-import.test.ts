import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { addSubscriberByHand, commitSubscriberImport, guessSubscriberMapping } from "@/server/subscribers/manage";

/**
 * Readers a publisher already had.
 *
 * The newsroom that signs up for Briefly does not arrive empty: it has a list, in a spreadsheet or
 * in the tool it is leaving. What is proved here is that bringing that list in behaves like a
 * publisher would expect and like the law requires at once — people land on the chosen titles,
 * somebody who unsubscribed is not quietly put back, and running the same file twice does not
 * double anybody.
 */
describe("bringing a list of readers in", () => {
  let orgId: string;
  let adminId: string;
  let publicationId: string;
  const stamp = Date.now();
  const email = (name: string) => `${name}.${stamp}@example.test`;

  beforeAll(async () => {
    await ensureSeeded();
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    publicationId = (await db.query.publications.findFirst({ where: eq(s.publications.organizationId, orgId) }))!.id;
  });

  it("adds one by hand, confirmed, on the title that was ticked", async () => {
    await runAsOrganization(orgId, async () => {
      const address = email("byhand");
      const outcome = await addSubscriberByHand(orgId, { email: address, firstName: "Marie", lastName: "Dupont", locale: "fr", publicationIds: [publicationId] }, adminId);
      expect(outcome.created).toBe(true);

      const row = await db.query.subscribers.findFirst({ where: and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, address)) });
      expect(row?.status).toBe("SUBSCRIBED");
      expect(row?.confirmedAt).toBeTruthy();
      // Where they came from is recorded rather than blended in with the people who signed up.
      expect(row?.source).toBe("by-hand");
      const link = await db.query.publicationSubscriptions.findFirst({ where: and(eq(s.publicationSubscriptions.subscriberId, row!.id), eq(s.publicationSubscriptions.publicationId, publicationId)) });
      expect(link?.isActive).toBe(true);

      // The same address twice is one reader, updated.
      const again = await addSubscriberByHand(orgId, { email: address, firstName: "Marie-Claire", locale: "fr", publicationIds: [publicationId] }, adminId);
      expect(again.created).toBe(false);
      expect((await db.select().from(s.subscribers).where(and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, address)))).length).toBe(1);
    });
  });

  it("leaves somebody who unsubscribed alone, unless that is asked for in as many words", async () => {
    await runAsOrganization(orgId, async () => {
      const address = email("gone");
      await addSubscriberByHand(orgId, { email: address, locale: "fr", publicationIds: [] }, adminId);
      await db.update(s.subscribers).set({ status: "UNSUBSCRIBED", unsubscribedAt: new Date() }).where(and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, address)));

      const refused = await addSubscriberByHand(orgId, { email: address, locale: "fr", publicationIds: [publicationId] }, adminId);
      expect(refused.skipped).toBe("unsubscribed");
      expect((await db.query.subscribers.findFirst({ where: and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, address)) }))?.status).toBe("UNSUBSCRIBED");

      const asked = await addSubscriberByHand(orgId, { email: address, locale: "fr", publicationIds: [publicationId], resubscribe: true }, adminId);
      expect(asked.skipped).toBeNull();
      expect((await db.query.subscribers.findFirst({ where: and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, address)) }))?.status).toBe("SUBSCRIBED");
    });
  });

  it("imports a sheet, says what it did, and does nothing the second time", async () => {
    await runAsOrganization(orgId, async () => {
      const header = ["Prénom", "Nom", "Adresse e-mail", "Langue"];
      const rows = [
        ["Jean", "Martin", email("jean"), "Français"],
        ["Léa", "Bernard", email("lea"), "English"],
        ["Cassé", "Ligne", "pas-une-adresse", "Français"],
      ];
      const mapping = guessSubscriberMapping(header);
      expect(mapping).toMatchObject({ mode: "separate", firstName: 0, lastName: 1, email: 2, locale: 3 });

      const first = await commitSubscriberImport(orgId, { rows, mapping, options: { publicationIds: [publicationId], updateExisting: true, resubscribe: false } }, adminId);
      expect(first).toMatchObject({ created: 2, skipped: 1, failed: 0 });

      const jean = await db.query.subscribers.findFirst({ where: and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, email("jean"))) });
      expect(jean).toMatchObject({ firstName: "Jean", lastName: "Martin", locale: "fr", status: "SUBSCRIBED", source: "by-hand" });
      expect((await db.query.subscribers.findFirst({ where: and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, email("lea"))) }))?.locale).toBe("en");

      // The same file again: everybody is already there, so nobody is added twice.
      const second = await commitSubscriberImport(orgId, { rows, mapping, options: { publicationIds: [publicationId], updateExisting: true, resubscribe: false } }, adminId);
      expect(second).toMatchObject({ created: 0, updated: 2, skipped: 1 });
    });
  });
});
