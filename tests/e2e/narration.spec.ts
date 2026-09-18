import { test, expect } from "@playwright/test";
import { ADMIN, login } from "./helpers";
import { one } from "./db";

/**
 * Spoken editions, from the customer's chair.
 *
 * The Audio tab names what it does in plain words and, on an install with no voice service
 * connected, says exactly that — with none of the provider's vocabulary. The Voice settings let
 * the workspace teach the narrator how its names are said.
 */
test.describe("narration", () => {
  test("the Audio tab explains itself and never names the provider", async ({ page }) => {
    await login(page, ADMIN);
    const edition = await one<{ id: string }>("select id from editions where hidden_at is null order by created_at asc limit 1");
    expect(edition).not.toBeNull();
    await page.goto(`/editions/${edition!.id}/audio`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Audio");
    await expect(page.getByText("Listen to this edition", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Narration is not connected on this Briefly yet")).toBeVisible();
    for (const word of ["ElevenLabs", "API key", "voice_id", "stability"]) await expect(page.locator("main").getByText(word, { exact: false })).toHaveCount(0);
  });

  test("the workspace can say how its names are pronounced", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/settings/voice");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Voice");
    await expect(page.getByRole("heading", { name: "House voice" })).toBeVisible();
    await page.getByRole("button", { name: "Add a word" }).click();
    await page.getByLabel("Written").fill("BDD");
    await page.getByLabel("Said").fill("business deep dive");
    await page.getByRole("button", { name: "Save voice" }).click();
    await expect(page.locator("[data-sonner-toast]").last()).toContainText("Voice saved");
    await page.reload();
    await expect(page.getByLabel("Written")).toHaveValue("BDD");
  });
});
