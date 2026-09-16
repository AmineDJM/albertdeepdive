import { beforeAll, describe, expect, it } from "vitest";
import { ensureSeeded } from "../helpers/db";
import { enqueueJob, processQueue, retryJob } from "@/server/jobs/queue";
import { registerJobHandler } from "@/server/jobs/registry";
import { db } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import { eq } from "drizzle-orm";

describe("job queue", () => {
  beforeAll(async () => {
    await ensureSeeded();
    registerJobHandler<{ fail?: boolean }, { done: boolean }>("test.echo", async (payload) => {
      if (payload.fail) throw new Error("boom");
      return { done: true };
    });
  });

  it("is idempotent on idempotency keys", async () => {
    const a = await enqueueJob({ type: "test.echo", idempotencyKey: "echo-1" });
    const b = await enqueueJob({ type: "test.echo", idempotencyKey: "echo-1" });
    expect(a.id).toBe(b.id);
  });

  it("runs handlers, retries with backoff and dead-letters after maxAttempts", async () => {
    const good = await enqueueJob({ type: "test.echo", payload: {} });
    const bad = await enqueueJob({ type: "test.echo", payload: { fail: true }, maxAttempts: 1 });
    const processed = await processQueue({ workerId: "test", max: 10 });
    expect(processed).toBeGreaterThanOrEqual(2);
    const goodRow = await db.query.jobs.findFirst({ where: eq(jobs.id, good.id) });
    const badRow = await db.query.jobs.findFirst({ where: eq(jobs.id, bad.id) });
    expect(goodRow?.status).toBe("SUCCEEDED");
    expect(goodRow?.result).toEqual({ done: true });
    expect(badRow?.status).toBe("DEAD");
    expect(badRow?.lastError).toContain("boom");
    const retried = await retryJob(bad.id);
    expect(retried?.status).toBe("QUEUED");
  });

  it("dead-letters unknown job types without crashing", async () => {
    const row = await enqueueJob({ type: "test.unknown" });
    await processQueue({ workerId: "test", max: 5 });
    const after = await db.query.jobs.findFirst({ where: eq(jobs.id, row.id) });
    expect(after?.status).toBe("DEAD");
  });
});
