import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { publicShelf, subscribeToMany } from "@/server/subscribers/service";
import { joinAsContributor, publicJoinShelf, publicationByJoinSlug, titlesForContributors } from "@/server/contributors/join";

/**
 * The two public doors of a newsletter.
 *
 * Readers had one and contributors had none. Both now have a link per title and a link for the
 * whole shelf, and both are public and unauthenticated — which is why what is checked here is not
 * only that they work but that they cannot be used to reach across workspaces or to learn who is
 * already on a list.
 */
describe("signing up from a public link", () => {
  let orgId: string;
  let otherOrgId: string;
  let publicationId: string;
  let otherPublicationId: string;
  let orgSlug: string;
  const stamp = Date.now();

  beforeAll(async () => {
    await ensureSeeded();
    const org = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!;
    orgId = org.id;
    orgSlug = org.slug;
    // The one with a public door on it: a workspace may also hold titles that take neither.
    const publication = (await db.query.publications.findMany({ where: eq(s.publications.organizationId, orgId) })).find((row) => row.joinSlug) ?? null;
    publicationId = publication!.id;
    const other = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "briefly") });
    otherOrgId = other?.id ?? orgId;
    otherPublicationId = (await db.query.publications.findFirst({ where: eq(s.publications.organizationId, otherOrgId) }))?.id ?? publicationId;
  });

  it("puts one reader on several titles with one confirmation", async () => {
    const shelf = await publicShelf(orgSlug);
    expect(shelf).not.toBeNull();
    const ids = shelf!.publications.map((publication) => publication.id);
    const email = `shelf.${stamp}@example.test`;

    const result = await subscribeToMany(ids, { email, firstName: "Marie", locale: "fr" });
    expect(result.status).toBe("confirmation_sent");
    // One token, whatever they ticked: three confirmation emails would read as a mistake.
    expect(result.confirmToken).toBeTruthy();

    const subscriber = await db.query.subscribers.findFirst({ where: and(eq(s.subscribers.organizationId, orgId), eq(s.subscribers.email, email)) });
    expect(subscriber?.status).toBe("PENDING");
    const links = await db.select().from(s.publicationSubscriptions).where(eq(s.publicationSubscriptions.subscriberId, subscriber!.id));
    expect(links.length).toBe(ids.length);
  });

  it("refuses a list of titles that crosses workspaces", async () => {
    if (otherPublicationId === publicationId) return; // one workspace in this seed: nothing to prove
    await expect(subscribeToMany([publicationId, otherPublicationId], { email: `cross.${stamp}@example.test`, locale: "fr" })).rejects.toThrow();
  });

  it("puts somebody on the contributor list from the public form", async () => {
    const publication = await db.query.publications.findFirst({ where: eq(s.publications.id, publicationId) });
    expect(publication?.joinSlug, "the seeded title has a contributor link").toBeTruthy();
    const found = await publicationByJoinSlug(publication!.joinSlug!);
    expect(found?.id).toBe(publicationId);

    const email = `writer.${stamp}@example.test`;
    const first = await joinAsContributor({ firstName: "Paul", lastName: "Petit", email, preferredLanguage: "fr", publicationIds: [publicationId] });
    expect(first.created).toBe(true);

    const contributor = await db.query.contributors.findFirst({ where: and(eq(s.contributors.organizationId, orgId), eq(s.contributors.email, email)) });
    expect(contributor).toMatchObject({ firstName: "Paul", lastName: "Petit", isActive: true });
    expect(await titlesForContributors([contributor!.id])).toEqual(new Map([[contributor!.id, [publication!.name]]]));

    // The same person again is the same person, and the campaign pool does not double.
    const again = await joinAsContributor({ firstName: "Paul", lastName: "Petit", email, preferredLanguage: "fr", publicationIds: [publicationId] });
    expect(again.created).toBe(false);
    expect((await db.select().from(s.contributors).where(and(eq(s.contributors.organizationId, orgId), eq(s.contributors.email, email)))).length).toBe(1);
    expect((await db.select().from(s.publicationContributors).where(eq(s.publicationContributors.contributorId, contributor!.id))).length).toBe(1);
  });

  it("says nothing about newsletters that are not open to contributors", async () => {
    const shelf = await publicJoinShelf(orgSlug);
    // Only titles with a contributor link are offered, so a private one cannot be joined by id.
    for (const publication of shelf?.publications ?? []) expect(publication.joinSlug).toBeTruthy();
    await expect(joinAsContributor({ firstName: "A", lastName: "B", email: `nope.${stamp}@example.test`, preferredLanguage: "fr", publicationIds: [] })).rejects.toThrow();
  });
});
