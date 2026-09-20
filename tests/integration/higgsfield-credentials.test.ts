import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationConfig, integrationStatuses, integrationValue } from "@/server/integrations/service";
import { higgsfieldImagery } from "@/server/creative/imagery";
import { imageProvider } from "@/server/images/providers";

/**
 * A credential set in the hosting environment reaches every place that needs it.
 *
 * The deployment keeps HF_CREDENTIALS in Render's environment rather than in the database, which
 * only helps if the code actually looks there — and "it reads process.env somewhere" is the kind of
 * claim that is true until somebody adds a second way to configure the same thing. Two consumers
 * resolve these credentials independently (Creative Studio's own provider chain, and the image
 * engine's router), and the console shows a third view of them. If any one of those grew its own
 * lookup, a workspace would be generating pictures from one screen and told it was not configured
 * on another.
 *
 * So this sets the variable, exercises all three through their real entry points, and unsets it to
 * prove the negative too — because a provider that is "available" with no credentials is worse than
 * one that is honestly missing.
 *
 * The value here is a fake of the right shape. Nothing in this file prints it, and the real one
 * never leaves the hosting environment.
 */
const FAKE = "test-key-id:test-key-secret";

describe("Higgsfield credentials from the environment", () => {
  let before: string | undefined;

  beforeAll(() => {
    before = process.env.HF_CREDENTIALS;
    process.env.HF_CREDENTIALS = FAKE;
  });

  afterAll(() => {
    if (before === undefined) delete process.env.HF_CREDENTIALS;
    else process.env.HF_CREDENTIALS = before;
  });

  it("reaches the integration layer without anything being saved in the console", async () => {
    const config = await integrationConfig("higgsfield");
    expect(config.apiKey, "the environment is read for the field that declares it").toBe(FAKE);
    expect(await integrationValue("higgsfield", "apiKey")).toBe(FAKE);
  }, 60_000);

  it("makes Creative Studio's provider and the image engine's provider both live", async () => {
    // The studio's own chain: this is what decides whether a carousel frame can be generated.
    expect(await higgsfieldImagery.available()).toBe(true);
    // And the image engine's router, which resolves providers by a different path entirely.
    expect(await imageProvider("higgsfield"), "the router sees the same credentials").not.toBeNull();
  }, 60_000);

  it("shows in the console as coming from the environment, masked and not editable", async () => {
    const statuses = await integrationStatuses();
    const higgsfield = statuses.find((each) => each.key === "higgsfield");
    expect(higgsfield, "the integration is listed").toBeDefined();
    const field = higgsfield!.fields.find((each) => each.key === "apiKey")!;
    expect(field.source, "so the empty-looking form field is explained rather than alarming").toBe("env");
    expect(field.envVar).toBe("HF_CREDENTIALS");
    // Masked, and the real characters never reach the page.
    expect(field.display).not.toBe(FAKE);
    expect(field.display).not.toContain("key-secret");
    expect(higgsfield!.configured).toBe(true);
  }, 60_000);

  it("is honestly unavailable when nothing is set, rather than quietly falling back", async () => {
    delete process.env.HF_CREDENTIALS;
    try {
      expect(await higgsfieldImagery.available()).toBe(false);
      expect(await imageProvider("higgsfield")).toBeNull();
    } finally {
      process.env.HF_CREDENTIALS = FAKE;
    }
  }, 60_000);

  it("refuses a value that is not both halves of the key", async () => {
    process.env.HF_CREDENTIALS = "only-the-id";
    try {
      // Higgsfield signs with key-id:key-secret. Half of that is not a credential, and saying so
      // here is cheaper than a job that fails at render time.
      expect(await higgsfieldImagery.available()).toBe(false);
    } finally {
      process.env.HF_CREDENTIALS = FAKE;
    }
  }, 60_000);
});
