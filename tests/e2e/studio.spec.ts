import { test, expect } from "@playwright/test";
import { closeDb, one } from "./db";
import { bodyOf, getAsPage, PLATFORM_ADMIN, login } from "./helpers";

/**
 * The studio's three doors: the work can be taken away, the words can be changed without touching
 * the look, and the platform can clean up after the whole thing. Runs against a database that
 * holds at least one finished pack — the seed does not make one, because a render takes a worker.
 */
test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

async function readyPack(): Promise<string> {
  const row = await one<{ id: string }>("select id from creative_packs where status = 'READY' order by created_at desc limit 1");
  expect(row, "a rendered pack must exist before the studio tests run").not.toBeNull();
  return String(row!.id);
}

test.describe("creative studio", () => {
  test("hands the pack over as one zip", async ({ page }) => {
    const packId = await readyPack();
    await login(page);
    await page.goto(`/studio/${packId}`);
    await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute("href", `/api/creative/${packId}/download`);

    // The same session the browser holds, so this is the click without the file dialog.
    const response = await getAsPage(page, `/api/creative/${packId}/download`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename=".+\.zip"$/);
    expect(bodyOf(response).length).toBeGreaterThan(1000);
  });

  test("refuses words that cannot be rendered, and says why", async ({ page }) => {
    const packId = await readyPack();
    await login(page);
    await page.goto(`/studio/${packId}`);
    await expect(page.getByRole("heading", { name: "The words" })).toBeVisible();
    await page.getByLabel("Frame 1 headline").fill("   ");
    await page.getByRole("button", { name: "Save and render" }).click();
    await expect(page.locator("main").getByText(/frames\.0\.headline/)).toBeVisible();
    // Nothing was saved: the page still shows the frames it had.
    await expect(page.getByRole("link", { name: "Download" })).toBeVisible();
  });

  test("changes the words and keeps the look", async ({ page }) => {
    const packId = await readyPack();
    await login(page);
    await page.goto(`/studio/${packId}`);
    await page.getByLabel("Frame 1 headline").fill("Edited from the end-to-end test");
    await page.getByRole("button", { name: "Save and render" }).click();
    await expect(page.locator("[data-sonner-toast]").last()).toContainText(/Saved/);
    await page.reload();
    await expect(page.getByLabel("Frame 1 headline")).toHaveValue("Edited from the end-to-end test");
  });

  test("the platform checks the bucket before it cleans it", async ({ page }) => {
    await login(page, PLATFORM_ADMIN);
    await page.goto("/admin/system");
    await page.getByRole("button", { name: "Check" }).click();
    await expect(page.locator("main").getByText(/\d+ stored · \d+ named by a pack · \d+ unreferenced/)).toBeVisible();
  });
});
