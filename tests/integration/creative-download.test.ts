import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import JSZip from "jszip";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { ensureDefaultPlans } from "@/server/billing/plans";
import { setOverrides } from "@/server/platform/overrides";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { createOrganization } from "@/server/tenancy/service";
import { runAsOrganization } from "@/server/tenancy/context";
import { createPack, deletePack, getPack, setBrief } from "@/server/creative/service";
import { getStorage } from "@/server/storage";
import { GET } from "@/app/api/creative/[packId]/download/route";
import type { CreativeBrief } from "@/lib/creative/brief";

/**
 * Getting the work out.
 *
 * The studio could make a carousel and show it, and had no way to hand it over. The zip is the
 * door, and it is the same door as every other file: the owning organisation's people, or platform
 * staff, and nobody else — a pack id is a UUID, but a link is a thing people paste into chats.
 */
const BASE = "http://127.0.0.1:3100";

const BRIEF: CreativeBrief = {
  format: "CAROUSEL",
  mode: "STUDIO",
  intent: "Show the work.",
  frames: [
    { layout: "statement", headline: "Three frames, one file", surface: "brand", emphasis: "loud" },
    { layout: "heading_body", headline: "What happened", body: "The studio learned to hand its work over.", surface: "paper", emphasis: "normal" },
    { layout: "cta", headline: "Read the whole thing", body: "The full edition.", surface: "accent", emphasis: "normal" },
  ],
  caption: "A caption that says something.",
  hashtags: ["briefly", "studio"],
};

describe("downloading a pack", () => {
  let adminId: string;
  let orgId: string;
  let packId: string;
  let unrenderedId: string;
  let adminCookie: string;
  let memberCookie: string;
  let outsiderCookie: string;

  const download = (id: string, cookie?: string) => {
    const headers = new Headers();
    if (cookie) headers.set("cookie", cookie);
    return GET(new Request(`${BASE}/api/creative/${id}/download`, { headers }), { params: Promise.resolve({ packId: id }) });
  };

  beforeAll(async () => {
    await ensureSeeded();
    await ensureDefaultPlans();
    const admin = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!;
    adminId = admin.id;
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    await setOverrides({ organizationId: orgId, patch: { socialPack: true, creativeCredits: null }, actorId: adminId });
    adminCookie = `${SESSION_COOKIE}=${(await createSession(admin.id)).token}`;

    const member = (await db.query.users.findFirst({ where: eq(s.users.role, "VIEWER") }))!;
    memberCookie = `${SESSION_COOKIE}=${(await createSession(member.id)).token}`;

    const other = await createOrganization({ name: "Another Customer SA", type: "COMPANY" }, admin.id);
    const [outsider] = await db
      .insert(s.users)
      .values({ email: "outsider@another-customer.example", name: "Outsider", role: "VIEWER", passwordHash: "x", isActive: true })
      .returning();
    await db.insert(s.organizationMembers).values({ organizationId: other.id, userId: outsider.id, role: "VIEWER", isDefault: true });
    outsiderCookie = `${SESSION_COOKIE}=${(await createSession(outsider.id)).token}`;

    await runAsOrganization(orgId, async () => {
      const pack = await createPack({ organizationId: orgId, name: "Été à Marseille: bilan", format: "CAROUSEL", mode: "STUDIO", actorId: adminId });
      packId = pack.id;
      await setBrief({ packId, brief: BRIEF, actorId: adminId });
      // Stand in for the renderer: a real stored file behind every frame.
      const storage = await getStorage();
      for (const asset of (await getPack(packId)).assets.filter((a) => a.kind === "FRAME")) {
        const key = `creative/${packId}/frame-${String(asset.index + 1).padStart(2, "0")}.jpg`;
        await storage.put(key, Buffer.from(`frame ${asset.index}`), { contentType: "image/jpeg" });
        await db.update(s.creativeAssets).set({ status: "READY", storageKey: key, mimeType: "image/jpeg" }).where(eq(s.creativeAssets.id, asset.id));
      }
      await db.update(s.creativePacks).set({ status: "READY" }).where(eq(s.creativePacks.id, packId));

      const bare = await createPack({ organizationId: orgId, name: "Not yet", format: "CAROUSEL", mode: "STUDIO", actorId: adminId });
      unrenderedId = bare.id;
      await setBrief({ packId: unrenderedId, brief: BRIEF, actorId: adminId });
    });
  });

  afterAll(async () => {
    await runAsOrganization(orgId, async () => {
      for (const id of [packId, unrenderedId]) if (id) await deletePack(id, adminId).catch(() => undefined);
    });
  });

  it("hands a member the frames in posting order, with the caption", async () => {
    const response = await download(packId, memberCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="ete-a-marseille-bilan.zip"');

    const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(["01.jpg", "02.jpg", "03.jpg", "README.txt", "caption.txt"]);
    expect(await zip.file("01.jpg")!.async("string")).toBe("frame 0");
    expect(await zip.file("03.jpg")!.async("string")).toBe("frame 2");
    expect(await zip.file("caption.txt")!.async("string")).toBe("A caption that says something.\n\n#briefly #studio\n");
  });

  it("serves platform staff", async () => {
    expect((await download(packId, adminCookie)).status).toBe(200);
  });

  it("refuses a signed-in user from another organisation", async () => {
    expect((await download(packId, outsiderCookie)).status).toBe(403);
  });

  it("refuses anyone with no session", async () => {
    expect((await download(packId)).status).toBe(403);
  });

  it("does not pretend a pack that has not rendered is a pack", async () => {
    // A brief and a caption are there; the frames are not. A zip with a text file in it would be
    // taken for the pack and posted as one.
    expect((await download(unrenderedId, memberCookie)).status).toBe(409);
  });

  it("says not found for a pack that does not exist, without leaking which ids do", async () => {
    expect((await download(crypto.randomUUID(), memberCookie)).status).toBe(404);
    expect((await download("not-a-uuid", memberCookie)).status).toBe(404);
  });
});
