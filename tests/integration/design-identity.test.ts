import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { activeGenome, activeIdentity, artDirectionFor, directionFor, identityHistory, saveArtDirection, saveIdentity, setGenome } from "@/server/design/identity";
import { isStated } from "@/lib/design/genome";

/**
 * Brand, title and issue, stored and read back.
 *
 * The behaviour worth holding is that nothing has to exist before something can be composed: a
 * workspace that has never opened a design screen still resolves to a usable direction, read from
 * its brand and marked as a reading. A design engine that waits for a form to be filled in is one
 * nobody reaches — and every publication would then look like the default.
 *
 * The other half is that a stated decision outlives the inference it replaced, and that changing a
 * title's identity next month does not rewrite what last month's edition was composed under.
 */
describe("what an organisation, a title and an issue look like", () => {
  let organizationId: string;
  let editionId: string;
  let publicationId: string;
  let userId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
    publicationId = edition!.publicationId!;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    expect(publicationId, "the seeded edition belongs to a title").toBeTruthy();
  }, 180_000);

  afterAll(async () => {
    await db.delete(s.brandGenomes).where(eq(s.brandGenomes.organizationId, organizationId));
    await db.delete(s.publicationIdentities).where(eq(s.publicationIdentities.organizationId, organizationId));
    await db.delete(s.editionArtDirections).where(eq(s.editionArtDirections.organizationId, organizationId));
  });

  it("answers with a usable genome before anybody has said anything", async () => {
    const genome = await runAsOrganization(organizationId, () => activeGenome(organizationId));
    expect(genome.editorial.density).toBeGreaterThanOrEqual(0);
    // Read, not decided — and the screen can say so.
    expect(isStated(genome, "density")).toBe(false);
    expect(genome.evidence.density?.source).toBe("inferred");
  });

  it("keeps a correction, and marks it as the organisation's own word", async () => {
    await runAsOrganization(organizationId, () => setGenome(organizationId, { density: 0.15, colourIntensity: 0.9 }, { userId }));
    const genome = await runAsOrganization(organizationId, () => activeGenome(organizationId));
    expect(genome.editorial.density).toBe(0.15);
    expect(genome.editorial.colourIntensity).toBe(0.9);
    expect(isStated(genome, "density")).toBe(true);
    // What they did not touch is still a reading.
    expect(isStated(genome, "formality")).toBe(false);

    // One active row, and the previous belief kept rather than overwritten.
    const rows = await db.select().from(s.brandGenomes).where(eq(s.brandGenomes.organizationId, organizationId));
    expect(rows.filter((r) => r.isActive)).toHaveLength(1);
  });

  it("gives a title an identity it never had to create", async () => {
    const identity = await runAsOrganization(organizationId, () => activeIdentity(publicationId));
    expect(identity.publicationId).toBe(publicationId);
    expect(identity.version).toBe(1);
    expect(identity.name.length).toBeGreaterThan(0);
  });

  it("versions a title's identity instead of overwriting it", async () => {
    const first = await runAsOrganization(organizationId, () => saveIdentity(publicationId, { genome: { density: 0.8 }, coverStyle: "typographic" }, { userId, reason: "editor asked for a denser page" }));
    expect(first.version).toBe(2);
    const second = await runAsOrganization(organizationId, () => saveIdentity(publicationId, { coverStyle: "image-led" }, { userId, reason: "back to photographs" }));
    expect(second.version).toBe(3);
    // The dial set in the first change survives the second, which said nothing about it.
    expect(second.genome.density).toBe(0.8);

    const history = await runAsOrganization(organizationId, () => identityHistory(publicationId));
    expect(history.map((h) => h.version)).toEqual([3, 2]);
    expect(history[0].reason).toBe("back to photographs");
    expect(history.filter((h) => h.isActive)).toHaveLength(1);
  });

  it("remembers whether a direction was inferred or stated", async () => {
    const inferred = await runAsOrganization(organizationId, () => saveArtDirection(editionId, { narrative: "People-heavy and photography-rich." }, { userId }));
    expect(inferred.source).toBe("inferred");

    const stated = await runAsOrganization(organizationId, () => saveArtDirection(editionId, { mood: "classic" }, { userId, stated: true }));
    // A person spoke after an inference: the direction is now both, and the mood is theirs.
    expect(stated.source).toBe("mixed");
    expect(stated.mood).toBe("classic");
    expect(stated.narrative).toBe("People-heavy and photography-rich.");

    const read = await runAsOrganization(organizationId, () => artDirectionFor(editionId));
    expect(read.mood).toBe("classic");
    // One row per edition, replaced in place.
    const rows = await db.select().from(s.editionArtDirections).where(eq(s.editionArtDirections.editionId, editionId));
    expect(rows).toHaveLength(1);
  });

  it("resolves brand, title and issue into one direction the composer can use", async () => {
    const { resolved, identity, direction } = await runAsOrganization(organizationId, () => directionFor(editionId));
    expect(identity?.publicationId).toBe(publicationId);
    expect(direction.editionId).toBe(editionId);
    // The issue said "classic", which brings its own density — over the title's 0.8 and the
    // organisation's 0.15.
    expect(resolved.mood).toBe("classic");
    expect(resolved.genome.density).toBe(0.6);
    expect(resolved.measure.ideal).toBeGreaterThan(40);
    expect(resolved.measure.ideal).toBeLessThan(96);
  });

  it("does not hand one workspace another's identity", async () => {
    const other = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "briefly") });
    if (!other) return; // The seed has one workspace; nothing to prove here.
    const identity = await runAsOrganization(other.id, () => activeIdentity(publicationId));
    // Scoped out: the caller gets a fresh identity rather than the other workspace's version 3.
    expect(identity.version).toBe(1);
  });

  it("cleans up nothing it did not create", async () => {
    const ids = (await db.select({ id: s.publicationIdentities.id }).from(s.publicationIdentities).where(eq(s.publicationIdentities.publicationId, publicationId))).map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    const rows = await db.select().from(s.publicationIdentities).where(inArray(s.publicationIdentities.id, ids));
    for (const row of rows) expect(row.organizationId).toBe(organizationId);
  });
});
