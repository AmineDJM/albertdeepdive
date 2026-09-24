import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import { env } from "@/server/env";
import type { ResolvedStorage } from "./config";
import type { PutOptions, SignedUrlOptions, StorageAdapter } from "./types";

/**
 * A client for one resolved configuration.
 *
 * Path-style addressing whenever an endpoint is given: every S3-compatible service that is not
 * AWS needs it, and Supabase is one of them.
 */
export function s3ClientFor(config: ResolvedStorage): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint || undefined,
    forcePathStyle: !!config.endpoint,
    credentials: config.accessKeyId && config.secretAccessKey ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } : undefined,
  });
}

/** The longest a SigV4 presigned URL may live: seven days. */
export const MAX_PRESIGN_SECONDS = 7 * 24 * 60 * 60;

/** S3-compatible storage: AWS S3, Cloudflare R2, Supabase Storage (S3 protocol), MinIO. */
export class S3StorageAdapter implements StorageAdapter {
  readonly name = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string | null;

  constructor(config: ResolvedStorage) {
    if (!config.bucket) throw new Error("Object storage has no bucket: name one on the storage card.");
    this.bucket = config.bucket;
    this.publicBaseUrl = config.publicBaseUrl;
    this.client = s3ClientFor(config);
  }

  async put(key: string, body: Buffer | Uint8Array, options: PutOptions) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: options.contentType, CacheControl: options.cacheControl, Metadata: options.metadata }));
    return { key, size: body.byteLength };
  }

  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async list(prefix: string) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys.sort();
  }

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions) {
    if (this.publicBaseUrl && !options?.download) {
      return `${this.publicBaseUrl.replace(/\/$/, "")}/${key}`;
    }
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: options?.download ? `attachment; filename="${options.download.fileName}"` : undefined,
    });
    // SigV4 refuses to sign past seven days, and throws rather than shortening. Anything asked for
    // longer is signed for the most it can be; what must outlive that uses a durable address
    // (src/server/media/durable.ts), never a longer signature.
    const expiresIn = Math.min(options?.expiresInSeconds ?? env.STORAGE_SIGNED_URL_TTL_SECONDS, MAX_PRESIGN_SECONDS);
    return presign(this.client, command, { expiresIn });
  }
}
