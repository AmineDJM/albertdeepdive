import { describe, expect, it } from "vitest";
import { DEFAULT_BUCKET, FALLBACK_REGION, normaliseEndpoint, resolve } from "@/server/storage/config";

const KEYS = { accessKeyId: "AKIA", secretAccessKey: "s3cret" };

describe("what a person pastes into the storage card", () => {
  it("completes a Supabase project URL into its S3 endpoint", () => {
    // The dashboard shows the project URL in one corner and the endpoint in another, and both get
    // pasted here. They are one path apart, so the path is added rather than the value refused.
    expect(normaliseEndpoint("https://abcdefgh.supabase.co")).toBe("https://abcdefgh.supabase.co/storage/v1/s3");
    expect(normaliseEndpoint("abcdefgh.supabase.co")).toBe("https://abcdefgh.supabase.co/storage/v1/s3");
    expect(normaliseEndpoint("https://abcdefgh.supabase.co/")).toBe("https://abcdefgh.supabase.co/storage/v1/s3");
    // Already an endpoint: left exactly as it is, and not doubled.
    expect(normaliseEndpoint("https://abcdefgh.supabase.co/storage/v1/s3")).toBe("https://abcdefgh.supabase.co/storage/v1/s3");
  });

  it("leaves every other service's endpoint alone", () => {
    // R2, Scaleway and MinIO each have their own shape, and none of them is ours to rewrite.
    expect(normaliseEndpoint("https://abc123.r2.cloudflarestorage.com")).toBe("https://abc123.r2.cloudflarestorage.com");
    expect(normaliseEndpoint("https://s3.fr-par.scw.cloud")).toBe("https://s3.fr-par.scw.cloud");
    expect(normaliseEndpoint("http://127.0.0.1:9000")).toBe("http://127.0.0.1:9000");
    expect(normaliseEndpoint("")).toBeNull();
    expect(normaliseEndpoint(null)).toBeNull();
  });
});

describe("where files go", () => {
  it("stays on disk while the card is empty", () => {
    expect(resolve({}).provider).toBe("local");
  });

  it("goes to the bucket as soon as an endpoint and a key are saved", () => {
    const config = resolve({ endpoint: "https://abcdefgh.supabase.co", ...KEYS });
    expect(config.provider).toBe("s3");
    expect(config.endpoint).toBe("https://abcdefgh.supabase.co/storage/v1/s3");
    // Nobody should have to invent a bucket name to get started.
    expect(config.bucket).toBe(DEFAULT_BUCKET);
    expect(config.region).toBe(FALLBACK_REGION);
  });

  it("keeps the bucket and region a person did name", () => {
    const config = resolve({ endpoint: "https://abcdefgh.supabase.co", bucket: "briefly-prod", region: "eu-west-3", ...KEYS });
    expect(config.bucket).toBe("briefly-prod");
    expect(config.region).toBe("eu-west-3");
  });

  it("stays on disk when half the card is filled in", () => {
    // A bucket with no credentials is the configuration that looks finished and fails on the first
    // upload. Local disk is wrong for a server, but it is loudly wrong rather than quietly.
    expect(resolve({ endpoint: "https://abcdefgh.supabase.co", accessKeyId: "AKIA" }).provider).toBe("local");
    expect(resolve({ bucket: "briefly-media" }).provider).toBe("local");
  });

  it("rebuilds the client when anything about the destination changes", () => {
    const base = { endpoint: "https://abcdefgh.supabase.co", bucket: "briefly-media", region: "eu-west-3", ...KEYS };
    const first = resolve(base).fingerprint;
    expect(resolve(base).fingerprint).toBe(first);
    expect(resolve({ ...base, bucket: "other" }).fingerprint).not.toBe(first);
    expect(resolve({ ...base, region: "us-east-1" }).fingerprint).not.toBe(first);
    expect(resolve({ ...base, accessKeyId: "AKIB" }).fingerprint).not.toBe(first);
  });
});
