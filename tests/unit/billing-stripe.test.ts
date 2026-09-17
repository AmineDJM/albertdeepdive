import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { mapStatus, verifyWebhookSignature } from "@/server/billing/stripe";

const SECRET = "whsec_test_secret";

function sign(payload: string, timestamp: number, secret = SECRET) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("Stripe webhook signatures", () => {
  beforeAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });

  const payload = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
  const now = () => Math.floor(Date.now() / 1000);

  it("accepts a signature this secret produced", async () => {
    await expect(verifyWebhookSignature(payload, sign(payload, now()))).resolves.toBe(true);
  });

  it("rejects everything else", async () => {
    // Without these checks anyone who finds the endpoint can grant themselves the Business plan.
    await expect(verifyWebhookSignature(payload, null), "no header").resolves.toBe(false);
    await expect(verifyWebhookSignature(payload, "garbage"), "malformed header").resolves.toBe(false);
    await expect(verifyWebhookSignature(payload, `t=${now()},v1=deadbeef`), "wrong signature").resolves.toBe(false);
    await expect(verifyWebhookSignature(payload, sign(payload, now(), "whsec_other")), "signed with another secret").resolves.toBe(false);
    await expect(verifyWebhookSignature(`${payload} `, sign(payload, now())), "payload altered after signing").resolves.toBe(false);
    await expect(verifyWebhookSignature(payload, `v1=${"a".repeat(64)}`), "no timestamp").resolves.toBe(false);
  });

  it("rejects a delivery old enough to be a replay", async () => {
    const old = now() - 3600;
    await expect(verifyWebhookSignature(payload, sign(payload, old))).resolves.toBe(false);
    // Still inside the tolerance.
    await expect(verifyWebhookSignature(payload, sign(payload, now() - 60))).resolves.toBe(true);
  });

  it("rejects everything when no secret is configured", async () => {
    // A Briefly with no webhook secret must accept no webhook at all — otherwise an unconfigured
    // install is an open door. The secret is read per call, so unsetting it is enough.
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      await expect(verifyWebhookSignature(payload, sign(payload, now()))).resolves.toBe(false);
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = saved;
    }
  });
});

describe("mapStatus", () => {
  it("maps the states Stripe actually sends", () => {
    expect(mapStatus("active")).toBe("ACTIVE");
    expect(mapStatus("trialing")).toBe("TRIALING");
    expect(mapStatus("past_due")).toBe("PAST_DUE");
    expect(mapStatus("unpaid")).toBe("UNPAID");
    expect(mapStatus("paused")).toBe("PAUSED");
    expect(mapStatus("incomplete")).toBe("INCOMPLETE");
    expect(mapStatus("incomplete_expired")).toBe("INCOMPLETE");
    expect(mapStatus("canceled")).toBe("CANCELED");
  });

  it("treats anything it does not recognise as not paying", () => {
    expect(mapStatus("something_new")).toBe("CANCELED");
  });
});
