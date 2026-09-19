import { describe, expect, it } from "vitest";
import { DurableStorageUnavailableError, FailClosedLocalAdapter, isScratchKey } from "@/server/storage/guard";
import type { StorageAdapter } from "@/server/storage/types";

/**
 * A durable upload that cannot be durable must fail, loudly, at the moment somebody makes it.
 *
 * The failure being prevented already happened: a deployment with no bucket connected accepted
 * every photograph onto a container's own filesystem, returned 200 for each of them, and lost the
 * lot on the next release. Nothing looked wrong until a month later, as a library of broken
 * pictures with no way to say when the bytes had gone.
 *
 * An upload that fails is fixed in ten minutes. An upload that silently succeeds into a filesystem
 * that will be replaced is found by a customer.
 */

function spy(): StorageAdapter & { puts: string[]; gets: string[] } {
  const puts: string[] = [];
  const gets: string[] = [];
  return {
    name: "local",
    puts,
    gets,
    async put(key, body) {
      puts.push(key);
      return { key, size: body.byteLength };
    },
    async get(key) {
      gets.push(key);
      return Buffer.from("x");
    },
    async delete() {},
    async exists() {
      return true;
    },
    async list() {
      return [];
    },
    async getSignedUrl(key) {
      return `signed:${key}`;
    },
    localPath(key) {
      return `/disk/${key}`;
    },
  };
}

describe("storage that fails closed", () => {
  it("refuses a durable key", async () => {
    const inner = spy();
    const guarded = new FailClosedLocalAdapter(inner);
    await expect(guarded.put("media/abc/original.jpg", Buffer.from("x"), { contentType: "image/jpeg" })).rejects.toBeInstanceOf(DurableStorageUnavailableError);
    await expect(guarded.put("publications/e/v/issue.pdf", Buffer.from("x"), { contentType: "application/pdf" })).rejects.toBeInstanceOf(DurableStorageUnavailableError);
    await expect(guarded.put("attachments/s/a.jpg", Buffer.from("x"), { contentType: "image/jpeg" })).rejects.toBeInstanceOf(DurableStorageUnavailableError);
    expect(inner.puts, "nothing may reach the disk").toEqual([]);
  });

  it("says what to do about it rather than just failing", async () => {
    const guarded = new FailClosedLocalAdapter(spy());
    const error = await guarded.put("media/abc/original.jpg", Buffer.from("x"), { contentType: "image/jpeg" }).catch((err: Error) => err);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Admin → Providers");
    expect((error as Error).message).toContain("media/abc/original.jpg");
  });

  it("still allows scratch, because a health check must run exactly when writes are refused", async () => {
    const inner = spy();
    const guarded = new FailClosedLocalAdapter(inner);
    await guarded.put("health/check-1.txt", Buffer.from("x"), { contentType: "text/plain" });
    await guarded.put("tmp/whatever.bin", Buffer.from("x"), { contentType: "application/octet-stream" });
    expect(inner.puts).toEqual(["health/check-1.txt", "tmp/whatever.bin"]);
    expect(isScratchKey("health/x")).toBe(true);
    expect(isScratchKey("tmp/x")).toBe(true);
    expect(isScratchKey("media/x")).toBe(false);
  });

  it("keeps serving what is already there", async () => {
    // Turning the guard on must protect the next install, not break a working one: everything
    // already on the disk stays readable, listable, signable and deletable.
    const inner = spy();
    const guarded = new FailClosedLocalAdapter(inner);
    expect(await guarded.get("media/abc/original.jpg")).toBeTruthy();
    expect(await guarded.getSignedUrl("media/abc/original.jpg")).toBe("signed:media/abc/original.jpg");
    expect(await guarded.exists("media/abc/original.jpg")).toBe(true);
    expect(guarded.localPath("media/abc/original.jpg")).toBe("/disk/media/abc/original.jpg");
    expect(inner.gets).toEqual(["media/abc/original.jpg"]);
  });
});
