import { afterAll, describe, expect, it } from "vitest";
import { ensureSeeded } from "../helpers/db";
import { clearIntegration, saveIntegration } from "@/server/integrations/service";
import { getStorage, resetStorage } from "@/server/storage";
import { resetStorageConfig, storageConfig } from "@/server/storage/config";

/**
 * The card that did nothing.
 *
 * Storage had a console card that stored a bucket and credentials, and a client that read only the
 * environment — so a platform admin could fill the card, save it, see it go green, and still have
 * every upload land on a disk the host wipes on redeploy. These pin the wiring: what is saved is
 * what is used, and clearing it puts files back where they were.
 */
describe("the storage card drives the storage", () => {
  const fake = {
    endpoint: "https://abcdefgh.supabase.co",
    accessKeyId: "test-access-key",
    secretAccessKey: "test-secret-key",
    bucket: "briefly-test-bucket",
    region: "eu-west-3",
  };

  afterAll(async () => {
    await clearIntegration("storage");
    resetStorageConfig();
    resetStorage();
  });

  it("writes to disk while nothing is connected", async () => {
    await ensureSeeded();
    await clearIntegration("storage");
    expect((await storageConfig()).provider).toBe("local");
    expect((await getStorage()).name).toBe("local");
  });

  it("moves to the bucket the moment the card is saved, with no redeploy and no variables", async () => {
    await saveIntegration("storage", fake);
    const config = await storageConfig();
    expect(config.provider).toBe("s3");
    expect(config.bucket).toBe(fake.bucket);
    expect(config.region).toBe(fake.region);
    // The project URL was completed into the S3 endpoint on the way through.
    expect(config.endpoint).toBe("https://abcdefgh.supabase.co/storage/v1/s3");
    const storage = await getStorage();
    expect(storage.name).toBe("s3");
    // An S3 adapter has no local path, which is what the reader route branches on.
    expect(storage.localPath).toBeUndefined();
  });

  it("names a bucket itself rather than asking for one", async () => {
    await saveIntegration("storage", { ...fake, bucket: "" });
    expect((await storageConfig()).bucket).toBe("briefly-media");
  });

  it("goes back to disk when the card is cleared", async () => {
    await clearIntegration("storage");
    expect((await storageConfig()).provider).toBe("local");
    const storage = await getStorage();
    expect(storage.name).toBe("local");
    expect(storage.localPath).toBeTypeOf("function");
  });
});
