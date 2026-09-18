import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { publicCollection, publicCollections, showableEditions } from "@/server/showcase/service";
import { setCustomerConsent, setPlatformConsent, showcaseStatusFor } from "@/server/showcase/consent";
import { addToCollection, adminCollection, createCollection, updateCollection } from "@/server/showcase/curation";

/**
 * The gallery's privacy rule, as assertions.
 *
 * The seed contains one customer (Albert School) and three workspaces Briefly owns. The customer's
 * work must be invisible until somebody there says otherwise, it must disappear again the moment
 * they change their mind, and no amount of curating may put it on the page in between.
 */
describe("what the public gallery may show", () => {
  let adminId: string;
  let albertPublicationId: string;
  let albertEditionId: string;

  beforeAll(async () => {
    await ensureSeeded();
    adminId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    const albert = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!;
    albertPublicationId = (await db.query.publications.findFirst({ where: eq(s.publications.organizationId, albert.id) }))!.id;
    albertEditionId = (await db.query.editions.findFirst({ where: eq(s.editions.organizationId, albert.id) }))!.id;
  });

  afterAll(async () => {
    await setCustomerConsent((await db.query.publications.findFirst({ where: eq(s.publications.id, albertPublicationId) }))!.organizationId, albertPublicationId, false, adminId);
  });

  it("shows Briefly's own demo workspaces and not the customer", async () => {
    const items = await showableEditions();
    expect(items.length).toBeGreaterThan(0);
    // Everything visible belongs to a workspace that consented.
    expect(items.some((item) => item.organization === "Northgate University")).toBe(true);
    expect(items.some((item) => item.organization === "Albert School")).toBe(false);
    // And every card carries the public address the gallery links to, never an internal one.
    for (const item of items) expect(item.href.startsWith("/r/")).toBe(true);
  });

  it("refuses to show a customer's edition even when a curator adds it", async () => {
    const collection = await createCollection({ title: "Privacy check", isPublished: true }, adminId);
    await addToCollection(collection.id, [albertEditionId], adminId);
    // The row exists…
    const inside = await adminCollection(collection.id);
    expect(inside!.items).toHaveLength(1);
    expect(inside!.items[0].showing).toBe(false);
    expect(inside!.items[0].why).toBe("Its title has not agreed to be shown.");
    // …and the public page draws nothing from it.
    const seen = await publicCollection("privacy-check");
    expect(seen?.items ?? []).toHaveLength(0);
    // A collection with nothing showable is not listed at all.
    expect((await publicCollections()).some((c) => c.slug === "privacy-check")).toBe(false);
    await db.delete(s.collections).where(eq(s.collections.id, collection.id));
  });

  it("will not let the platform call a customer's title a demo", async () => {
    await expect(setPlatformConsent(albertPublicationId, "PLATFORM_DEMO", null, adminId)).rejects.toThrow(/demo workspace/i);
    await expect(setPlatformConsent(albertPublicationId, "PERMISSION", "   ", adminId)).rejects.toThrow(/where the permission/i);
    expect((await db.query.publications.findFirst({ where: eq(s.publications.id, albertPublicationId) }))!.showcaseConsent).toBe("NONE");
  });

  it("records a permission with a note, and lets the customer take it back", async () => {
    const publication = (await db.query.publications.findFirst({ where: eq(s.publications.id, albertPublicationId) }))!;
    await setPlatformConsent(albertPublicationId, "PERMISSION", "Agreed by email, 12 March", adminId);
    let row = (await db.query.publications.findFirst({ where: eq(s.publications.id, albertPublicationId) }))!;
    expect(row.showcaseConsent).toBe("PERMISSION");
    expect(row.showcaseNote).toBe("Agreed by email, 12 March");
    // The customer's own screen shows it, and their switch clears it.
    const status = await showcaseStatusFor(publication.organizationId);
    expect(status.find((entry) => entry.publicationId === albertPublicationId)?.consent).toBe("PERMISSION");
    await setCustomerConsent(publication.organizationId, albertPublicationId, false, adminId);
    row = (await db.query.publications.findFirst({ where: eq(s.publications.id, albertPublicationId) }))!;
    expect(row.showcaseConsent).toBe("NONE");
    expect(row.showcaseNote).toBeNull();
  });

  it("still shows nothing for a consenting title with no published web page", async () => {
    const publication = (await db.query.publications.findFirst({ where: eq(s.publications.id, albertPublicationId) }))!;
    await setCustomerConsent(publication.organizationId, albertPublicationId, true, adminId);
    // Consent is necessary and not sufficient: the seed's customer editions have no WEB output.
    const items = await showableEditions();
    expect(items.some((item) => item.organization === "Albert School")).toBe(false);
    const status = await showcaseStatusFor(publication.organizationId);
    expect(status.find((entry) => entry.publicationId === albertPublicationId)?.showable).toBe(0);
  });

  it("keeps a draft collection off the gallery however complete it looks", async () => {
    const collection = await createCollection({ title: "Not ready" }, adminId);
    const showable = await showableEditions({ limit: 1 });
    await addToCollection(collection.id, [showable[0].editionId], adminId);
    expect(await publicCollection("not-ready")).toBeNull();
    await updateCollection(collection.id, { isPublished: true }, adminId);
    const live = await publicCollection("not-ready");
    expect(live?.items).toHaveLength(1);
    await db.delete(s.collections).where(eq(s.collections.id, collection.id));
  });

  it("puts one edition in several collections without copying it", async () => {
    const shared = (await showableEditions({ limit: 1 }))[0];
    const collections = await publicCollections();
    const featured = collections.find((c) => c.slug === "featured-this-month");
    expect(featured).toBeDefined();
    const rows = await db.select().from(s.collectionItems).where(eq(s.collectionItems.editionId, shared.editionId));
    expect(rows.length).toBeGreaterThan(1);
    // The same edition, one row per shelf, and one edition in the editions table.
    expect(new Set(rows.map((r) => r.editionId)).size).toBe(1);
  });
});
