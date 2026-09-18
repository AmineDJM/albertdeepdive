import sharp from "sharp";
import { HIGGSFIELD_DEFAULT_IMAGE_MODEL, HIGGSFIELD_IMAGE_CENTS, higgsfieldClient, higgsfieldImagery } from "@/server/creative/imagery";
import { download, ImageProviderError, type ImageProvider, type ImageRequest, type ImageResult } from "./types";

/**
 * Higgsfield, through the SDK client Creative Studio already holds: generation only, no
 * references, fitted to the size asked for. Kept in the route for the realistic scenes it draws well.
 */
export class HiggsfieldImageProvider implements ImageProvider {
  readonly name = "higgsfield" as const;
  available() {
    return higgsfieldImagery.available();
  }
  async generate(request: ImageRequest): Promise<ImageResult> {
    const { integrationConfig } = await import("@/server/integrations/service");
    const config = await integrationConfig("higgsfield");
    const credentials = config.apiKey?.trim();
    if (!credentials?.includes(":")) throw new ImageProviderError("Higgsfield has no usable credentials.", 401, false);
    const model = request.model || config.imageModel?.trim() || HIGGSFIELD_DEFAULT_IMAGE_MODEL;
    const baseURL = config.baseUrl?.trim().replace(/\/+$/, "");
    const client = await higgsfieldClient({ credentials, ...(baseURL ? { baseURL } : {}), maxPollTime: 5 * 60 * 1000 });
    const images: ImageResult["images"] = [];
    for (let index = 0; index < request.n; index += 1) {
      const result = await client.subscribe(model, { input: { prompt: request.prompt }, withPolling: true });
      const status = String(result?.status ?? "");
      if (status !== "completed") throw new ImageProviderError(status === "nsfw" ? "Higgsfield declined this picture." : `Higgsfield ended the request as "${status || "unknown"}".`, 502, status !== "nsfw");
      const url = result.images?.[0]?.url ?? result.jobs?.[0]?.results?.raw?.url;
      if (!url) throw new ImageProviderError("Higgsfield returned no picture.", 502, true);
      const raw = await download(url, globalThis.fetch);
      images.push({ bytes: await sharp(raw.bytes).resize(request.width, request.height, { fit: "cover" }).png().toBuffer(), mimeType: "image/png" });
    }
    return { images, model, costCents: HIGGSFIELD_IMAGE_CENTS * images.length, requestId: null };
  }
}
