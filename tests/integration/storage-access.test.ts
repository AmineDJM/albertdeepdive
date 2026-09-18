import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { createOrganization } from "@/server/tenancy/service";
import { getStorage } from "@/server/storage";
import { organizationOwning } from "@/server/storage/ownership";
import { GET } from "@/app/api/storage/[...key]/route";

/**
 * Whose file is it.
 *
 * The route used to answer "anyone signed in". Keys are UUIDs, so nobody guesses one — but a URL
 * copied from one customer's page opened in any other customer's account, indefinitely. These pin
 * the three doors: a signed link, membership of the owning organisation, or platform staff. Nothing
 * else.
 */
const BASE = "http://127.0.0.1:3100";

describe("file access across organisations", () => {
  let albertOrgId: string;
  let otherOrgId: string;
  let albertKey: string;
  let adminCookie: string;
  let albertMemberCookie: string;
  let outsiderCookie: string;

  const request = (path: string, cookie?: string) => {
    const headers = new Headers();
    if (cookie) headers.set("cookie", cookie);
    return new Request(`${BASE}${path}`, { headers });
  };
  const get = (key: string, cookie?: string) => GET(request(`/api/storage/${key}`, cookie), { params: Promise.resolve({ key: key.split("/") }) });

  beforeAll(async () => {
    await ensureSeeded();
    const admin = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!;
    albertOrgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    adminCookie = `${SESSION_COOKIE}=${(await createSession(admin.id)).token}`;

    // A member of Albert School who is not platform staff.
    const member = (await db.query.users.findFirst({ where: eq(s.users.role, "VIEWER") }))!;
    albertMemberCookie = `${SESSION_COOKIE}=${(await createSession(member.id)).token}`;

    // A different customer entirely, with one member.
    const other = await createOrganization({ name: "Somebody Else Ltd", type: "COMPANY" }, admin.id);
    otherOrgId = other.id;
    const [outsider] = await db
      .insert(s.users)
      .values({ email: "outsider@somebody-else.example", name: "Outsider", role: "VIEWER", passwordHash: "x", isActive: true })
      .returning();
    await db.insert(s.organizationMembers).values({ organizationId: otherOrgId, userId: outsider.id, role: "VIEWER", isDefault: true });
    outsiderCookie = `${SESSION_COOKIE}=${(await createSession(outsider.id)).token}`;

    // One of Albert School's files, with a real row behind it.
    const [asset] = await db
      .insert(s.mediaAssets)
      .values({ organizationId: albertOrgId, fileName: "secret.jpg", mimeType: "image/jpeg", sizeBytes: 3, storageKey: "pending", kind: "photo", rightsStatus: "GREEN" } as never)
      .returning();
    albertKey = `media/${asset.id}/web.webp`;
    await db.update(s.mediaAssets).set({ storageKey: albertKey }).where(eq(s.mediaAssets.id, asset.id));
    await getStorage().put(albertKey, Buffer.from("jpg"), { contentType: "image/webp" });
  });

  it("names the owner of every kind of key, and nobody for the rest", async () => {
    expect(await organizationOwning(albertKey)).toBe(albertOrgId);
    expect(await organizationOwning("creative/generated/deadbeefdeadbeefdeadbeefdeadbeef.jpg")).toBeNull();
    expect(await organizationOwning("tmp/anything.bin")).toBeNull();
    expect(await organizationOwning("media/not-a-uuid/web.webp")).toBeNull();
    expect(await organizationOwning(`media/${crypto.randomUUID()}/web.webp`)).toBeNull();
  });

  it("refuses a signed-in user from another organisation", async () => {
    // The whole finding in one assertion: signed in, valid session, and still not yours.
    expect((await get(albertKey, outsiderCookie)).status).toBe(403);
  });

  it("serves a member of the owning organisation", async () => {
    expect((await get(albertKey, albertMemberCookie)).status).toBe(200);
  });

  it("serves platform staff, who support every workspace", async () => {
    expect((await get(albertKey, adminCookie)).status).toBe(200);
  });

  it("refuses anyone at all with no session and no signature", async () => {
    expect((await get(albertKey)).status).toBe(403);
  });

  it("still honours a signed link, whoever holds it", async () => {
    // Sharing is done by minting a time-limited URL, not by being signed in.
    const signed = await getStorage().getSignedUrl(albertKey, { expiresInSeconds: 60 });
    const url = new URL(signed);
    const response = await GET(request(`${url.pathname}${url.search}`, outsiderCookie), { params: Promise.resolve({ key: albertKey.split("/") }) });
    expect(response.status).toBe(200);
  });

  it("never serves a shared generated ground or a temp file on the signed-in path", async () => {
    await getStorage().put("creative/generated/deadbeefdeadbeefdeadbeefdeadbeef.jpg", Buffer.from("x"), { contentType: "image/jpeg" });
    expect((await get("creative/generated/deadbeefdeadbeefdeadbeefdeadbeef.jpg", albertMemberCookie)).status).toBe(403);
    await getStorage().delete("creative/generated/deadbeefdeadbeefdeadbeefdeadbeef.jpg");
  });
});
