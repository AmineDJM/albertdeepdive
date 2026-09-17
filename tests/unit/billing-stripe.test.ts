import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
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

  it("accepts a signature this secret produced", () => {
    expect(verifyWebhookSignature(payload, sign(payload, now()))).toBe(true);
  });

  it("rejects everything else", () => {
    // Without these checks anyone who finds the endpoint can grant themselves the Business plan.
    expect(verifyWebhookSignature(payload, null), "no header").toBe(false);
    expect(verifyWebhookSignature(payload, "garbage"), "malformed header").toBe(false);
    expect(verifyWebhookSignature(payload, `t=${now()},v1=deadbeef`), "wrong signature").toBe(false);
    expect(verifyWebhookSignature(payload, sign(payload, now(), "whsec_other")), "signed with another secret").toBe(false);
    expect(verifyWebhookSignature(`${payload} `, sign(payload, now())), "payload altered after signing").toBe(false);
    expect(verifyWebhookSignature(payload, `v1=${"a".repeat(64)}`), "no timestamp").toBe(false);
  });

  it("rejects a delivery old enough to be a replay", () => {
    const old = now() - 3600;
    expect(verifyWebhookSignature(payload, sign(payload, old))).toBe(false);
    // Still inside the tolerance.
    expect(verifyWebhookSignature(payload, sign(payload, now() - 60))).toBe(true);
  });

  it("rejects everything when no secret is configured", async () => {
    // Environment is validated once at boot, so this needs a module with a different environment
    // rather than a deleted variable. A Briefly with no webhook secret must accept no webhook at
    // all — otherwise an unconfigured install is an open door.
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    vi.resetModules();
    const fresh = await import("@/server/billing/stripe");
    expect(fresh.verifyWebhookSignature(payload, sign(payload, now()))).toBe(false);
    process.env.STRIPE_WEBHOOK_SECRET = saved;
    vi.resetModules();
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
