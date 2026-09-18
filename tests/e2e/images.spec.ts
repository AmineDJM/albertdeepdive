import { test, expect } from "@playwright/test";
import { ADMIN, login } from "./helpers";
import { one } from "./db";

/**
 * Pictures, from the customer's chair.
 *
 * The media tab offers "Generate image" in plain words; a picture's page offers "Edit image" with
 * one sentence to fill in and an Advanced fold for the three dials — and none of it names a model
 * or a provider. The routing is the engine's business.
 */
test.describe("pictures", () => {
  test("the media tab offers to generate a picture in plain words", async ({ page }) => {
    await login(page, ADMIN);
    const edition = await one<{ id: string }>("select id from editions where hidden_at is null order by created_at asc limit 1");
    expect(edition).not.toBeNull();
    await page.goto(`/editions/${edition!.id}/media`);
    await page.getByRole("button", { name: "Generate image" }).click();
    await expect(page.getByRole("dialog")).toContainText("Real photographs from the library always come first");
    await page.getByLabel("What picture do you need?").fill("A warm photograph of the campus terrace at dusk");
    await page.getByRole("button", { name: "Advanced" }).click();
    await expect(page.getByLabel("Shape")).toBeVisible();
    await expect(page.getByLabel("Variations")).toHaveValue("");
    for (const word of ["OpenAI", "Gemini", "gpt-image", "Nano Banana", "Recraft", "Ideogram", "API key"]) await expect(page.getByRole("dialog").getByText(word, { exact: false })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("a picture's page offers to edit it as a new version", async ({ page }) => {
    await login(page, ADMIN);
    const asset = await one<{ id: string }>("select m.id from media_assets m join organizations o on o.id = m.organization_id where o.slug = 'albert-school' and m.is_archived = false and m.mime_type like 'image/%' order by m.created_at asc limit 1");
    expect(asset).not.toBeNull();
    await page.goto(`/media/${asset!.id}`);
    await expect(page.getByRole("heading", { name: "Edit image", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Describe the change" })).toBeVisible();
    await expect(page.getByLabel("What should change?")).toBeVisible();
    await expect(page.getByText("The original is never touched", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply the change" })).toBeVisible();
    await page.getByRole("button", { name: "Advanced" }).click();
    await expect(page.getByLabel("Preserve more")).toBeVisible();
    for (const word of ["OpenAI", "Gemini", "gpt-image", "Nano Banana", "Recraft", "Ideogram", "Routing"]) await expect(page.locator("main").getByText(word, { exact: false })).toHaveCount(0);
  });
});
