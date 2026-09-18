import type { ReferenceRole } from "@/lib/images/types";
import type { ImageProviderName } from "@/lib/images/capabilities";

/**
 * A picture provider, from Briefly's side.
 *
 * One request shape for every service: the prompt the plan wrote, the size, the references with
 * their roles, an optional mask, how many candidates. Each adapter translates that into the
 * service's own vocabulary and hands back bytes — always bytes, never a URL, because a URL is a
 * lease on somebody else's bucket and a picture that 404s next month was never made.
 */

export type ImageReferenceInput = { role: ReferenceRole; bytes: Buffer; mimeType: string };

export type ImageRequest = {
  /** The provider's own model identifier, after any override from the console. */
  model: string;
  prompt: string;
  width: number;
  height: number;
  references: ImageReferenceInput[];
  /** A PNG the size of the current version: transparent where the picture may change. */
  mask?: Buffer | null;
  n: number;
  seed?: number | null;
  output: "raster" | "vector";
  /** For Briefly's own generator: the colours to draw from. */
  palette?: string[];
};

export type ImageResult = {
  images: { bytes: Buffer; mimeType: string }[];
  model: string;
  costCents: number;
  requestId: string | null;
};

export interface ImageProvider {
  readonly name: ImageProviderName;
  available(): Promise<boolean>;
  generate(request: ImageRequest): Promise<ImageResult>;
  edit?(request: ImageRequest): Promise<ImageResult>;
}

export class ImageProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ImageProviderError";
  }
}

/** The size to ask for, from the fixed shapes an API offers: the one that loses least to the crop. */
export function nearestShape(width: number, height: number, shapes: { size: string; ratio: number }[]): string {
  const ratio = width / height;
  const kept = (candidate: number) => Math.min(ratio / candidate, candidate / ratio);
  return shapes.reduce((best, shape) => (kept(shape.ratio) > kept(best.ratio) ? shape : best)).size;
}

export async function download(url: string, fetchImpl: typeof globalThis.fetch): Promise<{ bytes: Buffer; mimeType: string }> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new ImageProviderError(`Could not download the generated picture (${res.status}).`, res.status, res.status >= 500);
  return { bytes: Buffer.from(await res.arrayBuffer()), mimeType: res.headers.get("content-type")?.split(";")[0] || "image/png" };
}
