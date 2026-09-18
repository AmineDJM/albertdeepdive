export type PutOptions = { contentType: string; cacheControl?: string; metadata?: Record<string, string> };
export type SignedUrlOptions = { expiresInSeconds?: number; download?: { fileName: string } };

export interface StorageAdapter {
  readonly name: "local" | "s3";
  put(key: string, body: Buffer | Uint8Array, options: PutOptions): Promise<{ key: string; size: number }>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Every key under a prefix. For housekeeping, which is the only caller that should ever need it. */
  list(prefix: string): Promise<string[]>;
  /** URL usable by browsers and by the PDF renderer, valid for a limited time. */
  getSignedUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  /** Absolute filesystem path when the adapter is disk-backed (used by the renderers). */
  localPath?(key: string): string;
}
