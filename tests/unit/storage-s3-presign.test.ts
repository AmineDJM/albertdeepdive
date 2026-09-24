import { describe, expect, it } from "vitest";
import { MAX_PRESIGN_SECONDS, S3StorageAdapter } from "@/server/storage/s3";

/**
 * SigV4 will not sign past seven days and throws instead of shortening, so a caller asking for a
 * year took the whole send down with it. The adapter signs for the most it can; what must outlive
 * that has its own durable address.
 */
describe("signing with S3", () => {
  const adapter = new S3StorageAdapter({
    provider: "s3",
    localDir: "",
    bucket: "briefly-test",
    region: "eu-west-1",
    endpoint: "https://s3.example.test",
    accessKeyId: "AKIATEST",
    secretAccessKey: "secret",
    publicBaseUrl: null,
    fingerprint: "test",
  });

  it("signs a year-long request for seven days rather than failing", async () => {
    const url = new URL(await adapter.getSignedUrl("media/a.jpg", { expiresInSeconds: 400 * 24 * 60 * 60 }));
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(MAX_PRESIGN_SECONDS));
  });

  it("keeps a short request short", async () => {
    const url = new URL(await adapter.getSignedUrl("media/a.jpg", { expiresInSeconds: 600 }));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("600");
  });
});
