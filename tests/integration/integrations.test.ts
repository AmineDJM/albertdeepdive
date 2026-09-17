import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { clearIntegration, integrationConfig, integrationStatuses, integrationValue, isConfigured, saveIntegration } from "@/server/integrations/service";
import { INTEGRATIONS, settingKeyFor } from "@/server/integrations/registry";

/**
 * Integrations hold the keys to somebody's Stripe account and somebody's sending reputation. The
 * properties worth proving are: the plaintext never reaches the database, it never reaches the
 * browser, and saving one field cannot destroy another.
 */
describe("integrations", () => {
  beforeAll(async () => {
    await ensureSeeded();
    // The test process sets STRIPE_WEBHOOK_SECRET; unset it here so stored values are exercised.
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it("stores a secret encrypted, never in the clear", async () => {
    await saveIntegration("stripe", { secretKey: "sk_test_supersecret_value", publishableKey: "pk_test_visible" });

    const [row] = await db.select({ value: s.systemSettings.value }).from(s.systemSettings).where(eq(s.systemSettings.key, settingKeyFor("stripe")));
    const serialised = JSON.stringify(row.value);
    expect(serialised).not.toContain("sk_test_supersecret_value");
    // A non-secret field is stored as it is — it is not a secret.
    expect(serialised).toContain("pk_test_visible");

    // And it still reads back for the code that needs it.
    expect(await integrationValue("stripe", "secretKey")).toBe("sk_test_supersecret_value");
    expect(await isConfigured("stripe")).toBe(true);
  });

  it("never sends a secret to the browser", async () => {
    const statuses = await integrationStatuses();
    const stripe = statuses.find((i) => i.key === "stripe")!;
    const secretField = stripe.fields.find((f) => f.key === "secretKey")!;
    expect(secretField.display).not.toBe("sk_test_supersecret_value");
    expect(secretField.display).toContain("•");
    // Enough to recognise the key, not enough to use it.
    expect(secretField.display).toContain("alue");
    expect(JSON.stringify(statuses)).not.toContain("sk_test_supersecret_value");
  });

  it("keeps a stored secret when an unrelated field is saved", async () => {
    // The console never shows the real value, so a blank secret field means "unchanged". Treating
    // it as "clear" would wipe a working key every time somebody edited a URL.
    await saveIntegration("stripe", { secretKey: "", publishableKey: "pk_test_changed" });
    expect(await integrationValue("stripe", "secretKey")).toBe("sk_test_supersecret_value");
    expect(await integrationValue("stripe", "publishableKey")).toBe("pk_test_changed");
  });

  it("clears a non-secret field when it is emptied", async () => {
    await saveIntegration("stripe", { publishableKey: "" });
    expect(await integrationValue("stripe", "publishableKey")).toBeNull();
  });

  it("lets the environment win over what was stored", async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = "pk_from_env";
    try {
      await saveIntegration("stripe", { publishableKey: "pk_from_database" });
      expect(await integrationValue("stripe", "publishableKey")).toBe("pk_from_env");
      const stripe = (await integrationStatuses()).find((i) => i.key === "stripe")!;
      // The console says so rather than showing an editable field that would be ignored.
      expect(stripe.fields.find((f) => f.key === "publishableKey")?.source).toBe("env");
    } finally {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
    }
  });

  it("disconnects completely", async () => {
    await clearIntegration("stripe");
    expect(await integrationValue("stripe", "secretKey")).toBeNull();
    expect(await isConfigured("stripe")).toBe(false);
    const config = await integrationConfig("stripe");
    expect(Object.values(config).every((v) => v === null)).toBe(true);
  });

  it("describes every integration it offers", async () => {
    const statuses = await integrationStatuses();
    expect(statuses.map((i) => i.key).sort()).toEqual(INTEGRATIONS.map((i) => i.key).sort());
    for (const integration of statuses) {
      expect(integration.summary.length, integration.key).toBeGreaterThan(20);
      expect(integration.whenMissing.length, integration.key).toBeGreaterThan(10);
      expect(integration.fields.length, integration.key).toBeGreaterThan(0);
      // The field that decides "connected" has to exist.
      const definition = INTEGRATIONS.find((i) => i.key === integration.key)!;
      expect(integration.fields.map((f) => f.key), integration.key).toContain(definition.primaryField);
    }
  });
});
