import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { ingestMedia } from "@/server/media/ingest";
import { durableImageToken, durableImageUrl, durableImageUrls, readDurableImageToken } from "@/server/media/durable";
import { recheckDuplicates } from "@/server/media/jobs";
import { getMediaDetail } from "@/server/media/library";
import { createOrganization } from "@/server/tenancy/service";
import { runAsOrganization } from "@/server/tenancy/context";
import { GET as imageRoute } from "@/app/api/public/image/[token]/route";

/**
 * Two things a picture's reach must not exceed.
 *
 * In time: a picture in a sent email is opened whenever the reader gets to it, so it has an address
 * of Briefly's that does not expire — and stops working the moment the picture is deleted or its
 * rights are refused. In space: a picture is compared, for duplicates and similarity, with its own
 * workspace's pictures and nobody else's.
 */

async function picture(colour: string, size = 400) {
  return sharp({ create: { width: size, height: size, channels: 3, background: colour } }).jpeg().toBuffer();
}

function call(token: string) {
  return imageRoute(new Request(`http://localhost:3000/api/public/image/${token}`), { params: Promise.resolve({ token }) } as never);
}

describe("a picture's reach", () => {
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    await ensureSeeded();
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    userId = (await db.query.users.findFirst({ where: eq(s.users.email, "admin@albertschool.com") }))!.id;
  });

  it("has an email address that names one size of one picture and cannot be altered", async () => {
    const { asset } = await ingestMedia({ buffer: await picture("#aa3355"), fileName: "reach.jpg", organizationId: orgId, userId });
    const token = durableImageToken(asset.id, "WEB");
    expect(readDurableImageToken(token)).toEqual({ assetId: asset.id, kind: "WEB" });
    expect(durableImageUrl(asset.id)).toMatch(/\/api\/public\/image\/[0-9a-f-]{36}\.web\./);

    const [id, , signature] = token.split(".");
    expect(readDurableImageToken(`${id}.print.${signature}`)).toBeNull();
    expect(readDurableImageToken(`${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.web.${signature}`)).toBeNull();
    expect(readDurableImageToken("nonsense")).toBeNull();

    expect(await durableImageUrls([asset.id, "00000000-0000-0000-0000-000000000000"])).toEqual({ [asset.id]: durableImageUrl(asset.id) });
  });

  it("sends the reader to a fresh signature, and stops once the rights are refused or the picture is gone", async () => {
    const { asset } = await ingestMedia({ buffer: await picture("#2255aa"), fileName: "served.jpg", organizationId: orgId, userId });
    const token = durableImageToken(asset.id, "WEB");

    const ok = await call(token);
    expect(ok.status).toBe(302);
    const location = ok.headers.get("location")!;
    expect(location).toContain("/api/storage/");
    expect(new URL(location).searchParams.get("sig")).toBeTruthy();

    await db.update(s.mediaAssets).set({ rightsStatus: "RED" }).where(eq(s.mediaAssets.id, asset.id));
    expect((await call(token)).status).toBe(404);

    await db.update(s.mediaAssets).set({ rightsStatus: "GREEN" }).where(eq(s.mediaAssets.id, asset.id));
    expect((await call(token)).status).toBe(302);
    await db.delete(s.mediaAssets).where(eq(s.mediaAssets.id, asset.id));
    expect((await call(token)).status).toBe(404);
    expect((await call(`${token}x`)).status).toBe(404);
  });

  it("is compared with its own workspace's pictures only", async () => {
    const other = await createOrganization({ name: "Another Newsroom", type: "COMPANY", locale: "en", timezone: "Europe/Paris" }, userId);
    // Noise, so the fingerprint is this picture's alone rather than that of every flat colour.
    const pixels = Buffer.alloc(300 * 300 * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(Math.random() * 256);
    const same = await sharp(pixels, { raw: { width: 300, height: 300, channels: 3 } }).jpeg().toBuffer();

    const theirs = await ingestMedia({ buffer: same, fileName: "theirs.jpg", organizationId: other.id, userId });
    const ours = await ingestMedia({ buffer: same, fileName: "ours.jpg", organizationId: orgId, userId });
    expect(ours.asset.duplicateOfId).toBeNull();
    expect(ours.asset.qualityFlags).not.toContain("EXACT_DUPLICATE");

    // Inside one workspace a duplicate is still a duplicate.
    const again = await ingestMedia({ buffer: same, fileName: "ours-again.jpg", organizationId: orgId, userId });
    expect(again.asset.duplicateOfId).toBe(ours.asset.id);

    const rechecked = await recheckDuplicates(ours.asset.id);
    expect(rechecked.nearest?.id).not.toBe(theirs.asset.id);

    const detail = await runAsOrganization(orgId, () => getMediaDetail(ours.asset.id));
    const shown = JSON.stringify(detail);
    expect(shown).not.toContain(theirs.asset.id);
    expect(shown).not.toContain("theirs.jpg");
  });
});
