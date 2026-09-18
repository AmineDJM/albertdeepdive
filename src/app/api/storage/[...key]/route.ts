import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { getStorage } from "@/server/storage";
import { verifyLocalSignature } from "@/server/storage/local";
import { getUserFromRequest } from "@/server/auth/session";
import { parseRange } from "@/lib/http/range";

const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  tif: "image/tiff",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  webm: "video/webm",
  mp4: "video/mp4",
  txt: "text/plain",
};

/**
 * Serves files from the local storage adapter. Access requires either a valid signed URL
 * (exp + sig, as produced by LocalStorageAdapter.getSignedUrl) or an authenticated newsroom user.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/storage/[...key]">) {
  const { key: parts } = await ctx.params;
  const key = parts.map(decodeURIComponent).join("/");
  if (key.includes("..")) return NextResponse.json({ error: "Invalid key" }, { status: 400 });
  const url = new URL(request.url);
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") ?? "";
  let allowed = sig ? verifyLocalSignature(key, exp, sig) : false;
  if (!allowed) {
    const user = await getUserFromRequest(request);
    allowed = !!user;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const storage = getStorage();
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MIME[ext] ?? "application/octet-stream";
  const download = url.searchParams.get("download");
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Cache-Control": sig ? "private, max-age=3600" : "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/["\r\n]/g, "")}"`;

  /*
   * Range requests, which is what makes a video seekable.
   *
   * A `<video>` asks for `bytes=0-` and then, the moment somebody drags the scrubber, for a range in
   * the middle. A server that answers every request with the whole file forces the browser to
   * download from the start again, so a ninety-second Reel cannot be scrubbed — and `Accept-Ranges`
   * is how the player knows it may try. Images and PDFs are unaffected: nothing asks them for a
   * range, and the whole-file path below still serves them.
   */
  headers["Accept-Ranges"] = "bytes";
  const range = request.headers.get("range");

  const respond = (body: Buffer, total: number) => {
    const parsed = range ? parseRange(range, total) : null;
    if (!parsed) {
      headers["Content-Length"] = String(total);
      return new NextResponse(new Uint8Array(body), { status: 200, headers });
    }
    if (parsed === "unsatisfiable") {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${total}` } });
    }
    const slice = body.subarray(parsed.start, parsed.end + 1);
    return new NextResponse(new Uint8Array(slice), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${parsed.start}-${parsed.end}/${total}`, "Content-Length": String(slice.length) },
    });
  };

  if (storage.localPath) {
    try {
      const filePath = storage.localPath(key);
      const stat = await fs.stat(filePath);
      const data = await fs.readFile(filePath);
      return respond(data, stat.size);
    } catch {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
  const buffer = await storage.get(key);
  if (!buffer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return respond(buffer, buffer.length);
}
