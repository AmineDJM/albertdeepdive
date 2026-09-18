import { test, expect } from "@playwright/test";
import { login } from "./helpers";

test.describe("newsroom smoke", () => {
  test("redirects anonymous visitors to login", async ({ page }) => {
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/login/);
  });

  test("signs in and shows the current edition on the overview", async ({ page }) => {
    await login(page);
    await expect(page.locator("main").getByText("Current edition", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /continue editing/i })).toBeVisible();
    await expect(page.locator("main").getByText("Campus coverage")).toBeVisible();
  });

  /*
   * The sidebar is six hubs, and a hub's own tabs appear only once you are in it — so Contributors
   * is reached through Audience, not from wherever you happen to be standing.
   *
   * This test used to click a top-level "Contributors" link that the navigation rework removed. It
   * went on passing in nobody's eyes for the same reason the rework went unnoticed: the end-to-end
   * suite could not start at all, so a stale test and a broken one looked identical.
   */
  test("navigates to editions, control room, contributors and campuses", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Editions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Editions" })).toBeVisible();
    await page.getByRole("link", { name: "May 2025" }).first().click();
    await expect(page.locator("main").getByText("Control room", { exact: true }).first()).toBeVisible();
    await expect(page.locator("main").getByText("Workflow", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Audience", exact: true }).click();
    await page.getByRole("link", { name: "Contributors", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Contributors" })).toBeVisible();
    await expect(page.locator("main").getByText("Milan Viallet").first()).toBeVisible();

    await page.getByRole("link", { name: "Campuses", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Campuses" })).toBeVisible();
    await expect(page.locator("main").getByText("Marseille", { exact: true }).first()).toBeVisible();
  });

  test("command palette searches across the newsroom", async ({ page }) => {
    await login(page);
    await page.keyboard.press("Control+K");
    const input = page.getByPlaceholder(/search everything/i);
    await expect(input).toBeVisible();
    await input.fill("Carrefour");
    await expect(page.getByText("Business Deep Dives", { exact: true })).toBeVisible({ timeout: 15000 });
  });

  test("viewer cannot create editions", async ({ page }) => {
    await login(page, { email: "viewer@albertschool.com", password: "albert-deep-dive" });
    await page.goto("/editions");
    await expect(page.getByRole("button", { name: /new edition/i })).toHaveCount(0);
  });
});
