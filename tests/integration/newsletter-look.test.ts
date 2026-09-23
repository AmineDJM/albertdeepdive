import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { and, eq } from "drizzle-orm";

// The addresses read here are stood in for; the DNS answers that each one is on the public internet.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { createPublication } from "@/server/publications/service";
import { applyNewsletterLook, newsletterLook } from "@/server/publications/brand";
import { activeBrand, activePublicationBrand, brandRecordFor } from "@/server/brand/service";
import { discoverNewsletterBrand, socialPlatform, type NewsletterBrandReading } from "@/server/tenancy/discovery";
import { resolveMasthead } from "@/server/email/masthead";
import { deleteMedia } from "@/server/media/rights";
import { runAsOrganization } from "@/server/tenancy/context";

/**
 * A newsletter dressed in its own look, read from its own address.
 *
 * A newsletter is given a website or a social page when it is created. What is read there — its
 * colours, its type, its mark — becomes its brand, built on its organisation's, and it is what its
 * editions and its emails wear. The organisation's own brand is not touched, a newsletter with no
 * address wears the organisation's, and a social page gives its link preview and nothing more.
 */

async function png(colour: string) {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: colour } }).png().toBuffer();
}

/** The open web, as far as these tests are concerned. */
function stubWeb(pages: Record<string, { body: string | Buffer; type: string }>) {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    const page = Object.entries(pages).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!page) return new Response("not found", { status: 404 });
    return new Response(typeof page.body === "string" ? page.body : new Uint8Array(page.body), { status: 200, headers: { "content-type": page.type } });
  });
}

describe("a newsletter's own look", () => {
  let orgId: string;
  let adminId: string;
  let admin: { id: string; role: (typeof s.users.$inferSelect)["role"] };

  beforeAll(async () => {
    await ensureSeeded();
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    const user = (await db.query.users.findFirst({ where: eq(s.users.email, "admin@albertschool.com") }))!;
    adminId = user.id;
    admin = { id: user.id, role: user.role };
  });

  afterEach(() => vi.unstubAllGlobals());

  const reading = (logoUrl: string | null, colours: string[], fonts = ["playfair display", "georgia"]): NewsletterBrandReading => ({
    url: "https://alumni.albertschool.test/",
    kind: "website",
    platform: null,
    name: "The Albert Alumni Review",
    description: null,
    logoUrl,
    logoCandidates: [],
    colours,
    fonts,
    readBy: "fetch",
    missing: [],
    notes: [],
  });

  it("keeps the address it is given, in full", async () => {
    const publication = await createPublication(orgId, { name: "Alumni Review", defaultFormats: ["EMAIL"], website: "alumni.albertschool.test/news" }, adminId);
    expect(publication.website).toBe("https://alumni.albertschool.test/news");
    await expect(createPublication(orgId, { name: "Broken Address", defaultFormats: ["EMAIL"], website: "not an address" }, adminId)).rejects.toThrow();
  });

  it("wears what was read at its address, keeps the mark, and leaves the organisation's brand alone", async () => {
    const organisationBrand = (await brandRecordFor({ organizationId: orgId })).system;
    const publication = await createPublication(orgId, { name: "Alumni Letter", defaultFormats: ["EMAIL"], website: "https://alumni.albertschool.test" }, adminId);
    stubWeb({ "https://alumni.albertschool.test/logo.png": { body: await png("#8a1538"), type: "image/png" } });

    const result = await applyNewsletterLook(publication.id, { actorId: adminId, reading: reading("https://alumni.albertschool.test/logo.png", ["#8a1538", "#d4af37"]) });
    expect(result.ownBrand).toBe(true);
    expect(result.logoMediaId).toBeTruthy();

    const own = (await activePublicationBrand(publication.id))!;
    expect(own.publicationId).toBe(publication.id);
    expect(own.system.colours.brand.toLowerCase()).toBe("#8a1538");
    expect(own.notes[0]).toBe("Read from https://alumni.albertschool.test/");
    // Everything the reading did not decide is the organisation's.
    expect(own.system.colours.ink).toBe(organisationBrand.colours.ink);
    expect((await activeBrand(orgId))?.system.colours.brand).toBe(organisationBrand.colours.brand);

    const logo = await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, result.logoMediaId!) });
    expect(logo).toMatchObject({ organizationId: orgId, kind: "logo", rightsStatus: "GREEN" });
    expect((await db.query.publications.findFirst({ where: eq(s.publications.id, publication.id) }))?.logoMediaId).toBe(logo!.id);

    const look = await newsletterLook({ organizationId: orgId, publicationId: publication.id });
    expect(look).toMatchObject({ own: true, name: "Alumni Letter", colour: own.system.colours.brand });
    expect(look.logoUrl).toBeTruthy();
  });

  it("dresses its emails and its editions, and only its own", async () => {
    const publication = await createPublication(orgId, { name: "Alumni Dispatch", defaultFormats: ["EMAIL"], website: "https://alumni.albertschool.test" }, adminId);
    stubWeb({ "https://alumni.albertschool.test/mark.png": { body: await png("#0b6e4f"), type: "image/png" } });
    await applyNewsletterLook(publication.id, { actorId: adminId, reading: reading("https://alumni.albertschool.test/mark.png", ["#0b6e4f"]) });
    const [edition] = await db
      .insert(s.editions)
      .values({ organizationId: orgId, publicationId: publication.id, label: "Look test", slug: `look-test-${Date.now()}`, issueNumber: 900 + Math.floor(Math.random() * 9000), title: "Look test", month: 10, year: 2026, status: "UPCOMING" })
      .returning();

    const masthead = await resolveMasthead({ organizationId: orgId, editionId: edition.id });
    expect(masthead?.name).toBe("Alumni Dispatch");
    expect(masthead?.colour?.toLowerCase()).toBe("#0b6e4f");
    expect(masthead?.logoUrl).toBeTruthy();
    expect((await brandRecordFor({ organizationId: orgId, publicationId: publication.id })).publicationId).toBe(publication.id);

    // A newsletter with no address of its own wears the organisation's.
    const plain = await createPublication(orgId, { name: "Plain Letter", defaultFormats: ["EMAIL"] }, adminId);
    expect((await newsletterLook({ organizationId: orgId, publicationId: plain.id })).own).toBe(false);
    expect((await resolveMasthead({ organizationId: orgId, publicationId: plain.id }))?.name).toBe("Plain Letter");
  });

  it("goes back to the organisation's look when its address is taken away, or when nothing could be read", async () => {
    const publication = await createPublication(orgId, { name: "Alumni Notes", defaultFormats: ["EMAIL"], website: "https://alumni.albertschool.test" }, adminId);
    expect((await applyNewsletterLook(publication.id, { actorId: adminId, reading: reading(null, [], []) })).ownBrand).toBe(false);

    stubWeb({ "https://alumni.albertschool.test/m.png": { body: await png("#223344"), type: "image/png" } });
    await applyNewsletterLook(publication.id, { actorId: adminId, reading: reading("https://alumni.albertschool.test/m.png", ["#223344"]) });
    await db.update(s.publications).set({ website: null }).where(eq(s.publications.id, publication.id));
    expect(await applyNewsletterLook(publication.id, { actorId: adminId })).toMatchObject({ ownBrand: false, logoMediaId: null });
    expect(await activePublicationBrand(publication.id)).toBeNull();
    expect((await newsletterLook({ organizationId: orgId, publicationId: publication.id })).own).toBe(false);
  });

  it("lets go of its mark when the picture is deleted from the library", async () => {
    const publication = await createPublication(orgId, { name: "Alumni Mark", defaultFormats: ["EMAIL"], website: "https://alumni.albertschool.test" }, adminId);
    stubWeb({ "https://alumni.albertschool.test/x.png": { body: await png("#445566"), type: "image/png" } });
    const { logoMediaId } = await applyNewsletterLook(publication.id, { actorId: adminId, reading: reading("https://alumni.albertschool.test/x.png", ["#445566"]) });
    await runAsOrganization(orgId, () => deleteMedia(logoMediaId!, admin));
    expect((await db.query.publications.findFirst({ where: eq(s.publications.id, publication.id) }))?.logoMediaId).toBeNull();
  });

  it("reads a social page's link preview and its picture's colours, never the network's own", async () => {
    expect(socialPlatform(new URL("https://www.instagram.com/albertschool"))).toBe("instagram");
    expect(socialPlatform(new URL("https://www.linkedin.com/company/albert-school"))).toBe("linkedin");
    expect(socialPlatform(new URL("https://albertschool.com"))).toBeNull();

    const html = `<html><head>
      <meta property="og:title" content="Albert Deep Dive (@albertdeepdive) • Instagram photos and videos" />
      <meta property="og:description" content="The monthly newspaper of Albert School." />
      <meta property="og:image" content="https://cdn.instagram.test/profile.jpg" />
      <link rel="icon" href="https://static.instagram.test/favicon.ico" />
    </head><body></body></html>`;
    stubWeb({
      "https://www.instagram.com/albertdeepdive": { body: html, type: "text/html" },
      "https://cdn.instagram.test/profile.jpg": { body: await png("#1d4ed8"), type: "image/png" },
    });
    const found = await discoverNewsletterBrand("www.instagram.com/albertdeepdive");
    expect(found).toMatchObject({ kind: "social", platform: "instagram", logoUrl: "https://cdn.instagram.test/profile.jpg", fonts: [], missing: [] });
    expect(found.name).toBe("Albert Deep Dive (@albertdeepdive) • Instagram photos and videos");
    expect(found.colours[0]).toMatch(/^#1[cd]4[de]d[89]$/i);
  });

  it("belongs to one workspace", async () => {
    const publication = await createPublication(orgId, { name: "Alumni Private", defaultFormats: ["EMAIL"] }, adminId);
    const rows = await db.query.brandSystems.findMany({ where: and(eq(s.brandSystems.publicationId, publication.id)) });
    expect(rows.every((row) => row.organizationId === orgId)).toBe(true);
  });
});
