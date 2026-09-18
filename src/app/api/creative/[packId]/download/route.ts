import { NextResponse } from "next/server";
import JSZip from "jszip";
import { getUserFromRequest } from "@/server/auth/session";
import { organizationOwning } from "@/server/storage/ownership";
import { organizationIdsForUser, runAsOrganization } from "@/server/tenancy/context";
import { getPack } from "@/server/creative/service";
import { getStorage } from "@/server/storage";
import { FORMATS } from "@/lib/creative/formats";

/**
 * A pack, as one file somebody can post from.
 *
 * The studio could make a carousel and show it and had no way to hand it over: the frames were
 * images on a page, to be saved one at a time by right-click, and the video the same. This is the
 * door. Frames numbered in order, the video, the caption with its hashtags as a text file — which is
 * the exact set of things a person pastes into a platform, in the order they paste them.
 *
 * Stored, not deflated: every file in here is a JPEG or an H.264 stream and compresses to itself.
 * The zip is a container, and spending CPU to make it a few bytes smaller would be theatre.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/creative/[packId]/download">) {
  const { packId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(packId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The same door as every other file: a member of the owning organisation, or platform staff.
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const owner = await organizationOwning(`creative/${packId}/pack.zip`);
  if (!owner) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (user.role !== "SUPER_ADMIN" && !(await organizationIdsForUser(user.id)).includes(owner)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pack = await runAsOrganization(owner, () => getPack(packId));
  const storage = getStorage();
  const zip = new JSZip();
  const format = FORMATS[pack.format];
  // What has actually been rendered. The caption rides along but does not count: a zip holding
  // nothing but a text file is not a pack, and the person is better told to wait.
  let rendered = 0;

  const frames = pack.assets.filter((asset) => asset.kind === "FRAME" && asset.status === "READY" && asset.storageKey).sort((a, b) => a.index - b.index);
  for (const frame of frames) {
    const bytes = await storage.get(frame.storageKey!);
    if (!bytes) continue;
    const extension = frame.mimeType === "image/png" ? "png" : "jpg";
    zip.file(`${String(frame.index + 1).padStart(2, "0")}.${extension}`, bytes);
    rendered += 1;
  }
  const video = pack.assets.find((asset) => asset.kind === "VIDEO" && asset.status === "READY" && asset.storageKey);
  if (video) {
    const bytes = await storage.get(video.storageKey!);
    if (bytes) {
      zip.file(`${slug(pack.name)}.mp4`, bytes);
      rendered += 1;
    }
  }
  if (pack.brief) {
    const caption = [pack.brief.caption, pack.brief.hashtags.length ? pack.brief.hashtags.map((tag) => `#${tag}`).join(" ") : null].filter(Boolean).join("\n\n");
    zip.file("caption.txt", `${caption}\n`);
  }
  if (!rendered) return NextResponse.json({ error: "Nothing rendered yet" }, { status: 409 });

  zip.file(
    "README.txt",
    [
      `${pack.name}`,
      `${format.name} · ${format.width}×${format.height}${format.moving ? " · video included" : ""}`,
      "",
      "Frames are numbered in posting order. caption.txt holds the post text and hashtags.",
      "Made with Briefly. Every frame was drawn by Briefly's own renderer; nothing here is a picture of text.",
      "",
    ].join("\n"),
  );

  const body = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(body.length),
      "Content-Disposition": `attachment; filename="${slug(pack.name)}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
}

const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "pack";
