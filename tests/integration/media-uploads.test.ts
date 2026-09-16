import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { ensureSeeded } from "../helpers/db";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { POST as uploadsPost } from "@/app/api/uploads/route";
import { DELETE as mediaDelete, GET as mediaGet, PATCH as mediaPatch } from "@/app/api/media/[assetId]/route";
import { parseUploadForm, uploadMedia } from "@/server/media/upload";
import type { SeedResult } from "@/server/db/seed";

const BASE = "http://127.0.0.1:3100";

let seed: SeedResult;
let adminCookie: string;
let viewerCookie: string;
let storyId: string;

async function cookieForRole(role: "SUPER_ADMIN" | "VIEWER") {
  const user = await db.query.users.findFirst({ where: eq(s.users.role, role) });
  if (!user) throw new Error(`No seeded user with role ${role}`);
  const session = await createSession(user.id, { userAgent: "vitest" });
  return `${SESSION_COOKIE}=${session.token}`;
}

async function imageBuffer(width: number, height: number, seedColour: number) {
  // A gradient-ish image so the perceptual hash is not trivial and files differ between calls.
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 255) / width;
      raw[i + 1] = (y * 255) / height;
      raw[i + 2] = seedColour;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
}

function request(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new Request(`${BASE}${path}`, { ...init, headers });
}

beforeAll(async () => {
  seed = await ensureSeeded();
  adminCookie = await cookieForRole("SUPER_ADMIN");
  viewerCookie = await cookieForRole("VIEWER");
  const story = await db.query.stories.findFirst({ where: eq(s.stories.editionId, seed.editionId) });
  storyId = story!.id;
});

describe("POST /api/uploads", () => {
  it("rejects anonymous, unauthorised and cross-origin requests", async () => {
    const form = new FormData();
    form.append("editionId", seed.editionId);
    form.append("file", new File([await imageBuffer(64, 64, 10)], "x.jpg", { type: "image/jpeg" }));
    expect((await uploadsPost(request("/api/uploads", { method: "POST", body: form }))).status).toBe(401);
    expect((await uploadsPost(request("/api/uploads", { method: "POST", body: form, cookie: viewerCookie }))).status).toBe(403);
    const crossOrigin = await uploadsPost(request("/api/uploads", { method: "POST", body: form, cookie: adminCookie, headers: { origin: "https://evil.example" } }));
    expect(crossOrigin.status).toBe(403);
  });

  it("validates the body: missing file, bad edition, unsupported type, oversized file", async () => {
    const noFile = new FormData();
    noFile.append("editionId", seed.editionId);
    const r1 = await uploadsPost(request("/api/uploads", { method: "POST", body: noFile, cookie: adminCookie }));
    expect(r1.status).toBe(400);
    expect((await r1.json()).error).toMatch(/no file/i);

    const badEdition = new FormData();
    badEdition.append("editionId", "not-a-uuid");
    badEdition.append("file", new File([await imageBuffer(64, 64, 20)], "x.jpg", { type: "image/jpeg" }));
    expect((await uploadsPost(request("/api/uploads", { method: "POST", body: badEdition, cookie: adminCookie }))).status).toBe(400);

    const text = new FormData();
    text.append("editionId", seed.editionId);
    text.append("file", new File([Buffer.from("hello, not an image")], "notes.txt", { type: "text/plain" }));
    const r3 = await uploadsPost(request("/api/uploads", { method: "POST", body: text, cookie: adminCookie }));
    expect(r3.status).toBe(415);
    expect((await r3.json()).code).toBe("UNSUPPORTED_TYPE");

    const previous = env.UPLOAD_MAX_FILE_MB;
    (env as { UPLOAD_MAX_FILE_MB: number }).UPLOAD_MAX_FILE_MB = 0.001;
    try {
      const big = new FormData();
      big.append("editionId", seed.editionId);
      big.append("file", new File([await imageBuffer(400, 400, 30)], "big.jpg", { type: "image/jpeg" }));
      const r4 = await uploadsPost(request("/api/uploads", { method: "POST", body: big, cookie: adminCookie }));
      expect(r4.status).toBe(413);
    } finally {
      (env as { UPLOAD_MAX_FILE_MB: number }).UPLOAD_MAX_FILE_MB = previous;
    }

    const wrongContentType = await uploadsPost(request("/api/uploads", { method: "POST", body: JSON.stringify({}), cookie: adminCookie, headers: { "content-type": "application/json" } }));
    expect(wrongContentType.status).toBe(400);
  });

  it("uploads several files, applies per-file metadata, attaches them to a story and queues processing", async () => {
    const form = new FormData();
    form.append("editionId", seed.editionId);
    form.append("storyId", storyId);
    form.append("role", "gallery");
    form.append("photographer", "Test Photographer");
    form.append("rightsStatus", "GREEN");
    form.append("meta", JSON.stringify([{ caption: "First test photo" }, { caption: "Second test photo", kind: "screenshot" }]));
    form.append("file", new File([await imageBuffer(1800, 1200, 40)], "team photo.jpg", { type: "image/jpeg" }));
    form.append("file", new File([await imageBuffer(900, 600, 50)], "dashboard.jpg", { type: "image/jpeg" }));
    const res = await uploadsPost(request("/api/uploads", { method: "POST", body: form, cookie: adminCookie }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assets: { id: string; thumbUrl: string; webUrl: string; width: number; height: number; qualityScore: number; qualityFlags: string[]; duplicateOfId: string | null; storyId: string | null }[] };
    expect(body.assets).toHaveLength(2);
    const [first, second] = body.assets;
    expect(first.width).toBe(1800);
    expect(first.height).toBe(1200);
    expect(first.thumbUrl).toContain("/api/storage/media/");
    expect(first.webUrl).toContain("web.webp");
    expect(first.storyId).toBe(storyId);
    expect(typeof first.qualityScore).toBe("number");
    expect(Array.isArray(first.qualityFlags)).toBe(true);

    const rows = await db.query.mediaAssets.findMany({ where: eq(s.mediaAssets.uploadedByUserId, (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id) });
    const a = rows.find((r) => r.id === first.id)!;
    const b = rows.find((r) => r.id === second.id)!;
    expect(a.caption).toBe("First test photo");
    expect(a.photographer).toBe("Test Photographer");
    expect(a.credit).toBe("© Test Photographer");
    expect(a.rightsStatus).toBe("GREEN");
    expect(a.editionId).toBe(seed.editionId);
    expect(b.caption).toBe("Second test photo");
    expect(b.kind).toBe("screenshot");

    const links = await db.query.storyMedia.findMany({ where: and(eq(s.storyMedia.storyId, storyId)) });
    expect(links.some((l) => l.mediaAssetId === first.id && l.role === "gallery")).toBe(true);
    expect(links.some((l) => l.mediaAssetId === second.id)).toBe(true);

    const jobs = await db.query.jobs.findMany({ where: eq(s.jobs.type, "media.process") });
    expect(jobs.some((j) => (j.payload as { assetId: string }).assetId === first.id && j.status === "QUEUED")).toBe(true);
    const audit = await db.query.auditLog.findMany({ where: and(eq(s.auditLog.entityType, "MEDIA"), eq(s.auditLog.entityId, first.id)) });
    expect(audit.map((e) => e.action)).toEqual(expect.arrayContaining(["media.upload", "media.attach"]));
  });

  it("flags a re-upload of the same file as an exact duplicate", async () => {
    const buffer = await imageBuffer(1200, 800, 60);
    const admin = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!;
    const [original] = await uploadMedia({ files: [{ buffer, fileName: "same.jpg", mimeType: "image/jpeg" }], editionId: seed.editionId, actor: { id: admin.id, role: admin.role }, skipProcessing: true });
    const [copy] = await uploadMedia({ files: [{ buffer, fileName: "same-again.jpg", mimeType: "image/jpeg" }], editionId: seed.editionId, actor: { id: admin.id, role: admin.role }, skipProcessing: true });
    expect(copy.duplicateOfId).toBe(original.id);
    expect(copy.qualityFlags).toContain("EXACT_DUPLICATE");
  });

  it("parses shared fields and per-file overrides from the multipart form", async () => {
    const form = new FormData();
    form.append("editionId", seed.editionId);
    form.append("caption", "Shared caption");
    form.append("meta", JSON.stringify([{}, { caption: "Own caption", rightsStatus: "RED" }]));
    form.append("file", new File([Buffer.from("a")], "a.jpg", { type: "image/jpeg" }));
    form.append("file", new File([Buffer.from("b")], "b.jpg", { type: "image/jpeg" }));
    const parsed = await parseUploadForm(form);
    expect(parsed.editionId).toBe(seed.editionId);
    expect(parsed.files.map((f) => f.caption)).toEqual(["Shared caption", "Own caption"]);
    expect(parsed.files[1].rightsStatus).toBe("RED");
    expect(parsed.files[0].fileName).toBe("a.jpg");
  });
});

describe("GET / PATCH / DELETE /api/media/[assetId]", () => {
  it("returns the detail JSON without storage keys, edits metadata and archives", async () => {
    const asset = (await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.editionId, seed.editionId) }))!;
    const ctx = { params: Promise.resolve({ assetId: asset.id }) };

    expect((await mediaGet(request(`/api/media/${asset.id}`), ctx)).status).toBe(401);
    const res = await mediaGet(request(`/api/media/${asset.id}`, { cookie: viewerCookie }), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { asset: Record<string, unknown>; variants: { kind: string; url: string }[]; previewUrl: string; stories: unknown[] };
    expect(body.asset.id).toBe(asset.id);
    expect(body.asset.storageKey).toBeUndefined();
    expect(body.variants.length).toBeGreaterThanOrEqual(3);
    expect(body.previewUrl).toContain("/api/storage/");
    expect(Array.isArray(body.stories)).toBe(true);

    const missing = await mediaGet(request(`/api/media/00000000-0000-4000-8000-000000000000`, { cookie: adminCookie }), { params: Promise.resolve({ assetId: "00000000-0000-4000-8000-000000000000" }) });
    expect(missing.status).toBe(404);

    expect((await mediaPatch(request(`/api/media/${asset.id}`, { method: "PATCH", body: JSON.stringify({ caption: "Via API" }), cookie: viewerCookie, headers: { "content-type": "application/json" } }), ctx)).status).toBe(403);
    const patched = await mediaPatch(request(`/api/media/${asset.id}`, { method: "PATCH", body: JSON.stringify({ caption: "Via API" }), cookie: adminCookie, headers: { "content-type": "application/json" } }), ctx);
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { asset: { caption: string } }).asset.caption).toBe("Via API");

    expect((await mediaDelete(request(`/api/media/${asset.id}`, { method: "DELETE", cookie: viewerCookie }), ctx)).status).toBe(403);
    const deleted = await mediaDelete(request(`/api/media/${asset.id}`, { method: "DELETE", cookie: adminCookie }), ctx);
    expect(deleted.status).toBe(200);
    expect((await db.query.mediaAssets.findFirst({ where: eq(s.mediaAssets.id, asset.id) }))?.isArchived).toBe(true);
  });
});
