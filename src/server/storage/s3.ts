import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import { env } from "@/server/env";
import type { PutOptions, SignedUrlOptions, StorageAdapter } from "./types";

/** S3-compatible storage: AWS S3, Cloudflare R2, Supabase Storage (S3 protocol), MinIO. */
export class S3StorageAdapter implements StorageAdapter {
  readonly name = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    if (!env.STORAGE_S3_BUCKET) throw new Error("STORAGE_S3_BUCKET is required when STORAGE_PROVIDER=s3");
    this.bucket = env.STORAGE_S3_BUCKET;
    this.client = new S3Client({
      region: env.STORAGE_S3_REGION,
      endpoint: env.STORAGE_S3_ENDPOINT || undefined,
      forcePathStyle: !!env.STORAGE_S3_ENDPOINT,
      credentials:
        env.STORAGE_S3_ACCESS_KEY_ID && env.STORAGE_S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID, secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY }
          : undefined,
    });
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

  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, options?: SignedUrlOptions) {
    if (env.STORAGE_S3_PUBLIC_BASE_URL && !options?.download) {
      return `${env.STORAGE_S3_PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`;
    }
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: options?.download ? `attachment; filename="${options.download.fileName}"` : undefined,
    });
    return presign(this.client, command, { expiresIn: options?.expiresInSeconds ?? env.STORAGE_SIGNED_URL_TTL_SECONDS });
  }
}
