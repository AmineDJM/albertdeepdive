import { test, expect } from "@playwright/test";
import { PLATFORM_ADMIN, login } from "./helpers";

/**
 * The person who runs Briefly is not a customer.
 *
 * They sign in and land on the console, not in Albert School's newsroom; the sidebar offers the
 * console and nothing of a workspace they do not have. A customer's newsroom opens only when they
 * ask for it by name, says so while they are inside, and has a door back out.
 */
test.describe("platform staff", () => {
  test("land on the console and open a customer only on purpose", async ({ page }) => {
    await login(page, PLATFORM_ADMIN);
    await expect(page).toHaveURL(/\/platform$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Platform");

    // No newsroom to navigate: the workspace header reads Briefly, and Overview is not on offer.
    const sidebar = page.getByRole("navigation", { name: "Main" });
    await expect(sidebar.getByRole("link", { name: "Platform" })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Overview" })).toHaveCount(0);
    await expect(page.getByText("Working on")).toHaveCount(0);

    // A newsroom route is not theirs to see: it sends them back to the console.
    await page.goto("/overview");
    await expect(page).toHaveURL(/\/platform$/);
    await page.goto("/editions");
    await expect(page).toHaveURL(/\/platform$/);

    // Opening a customer is explicit, and flagged while they are inside.
    await page.goto("/platform/workspaces");
    await page.getByRole("button", { name: "Manage Albert School" }).click();
    await page.getByRole("menuitem", { name: "Open with full rights" }).click();
    await page.waitForURL(/\/overview/);
    await expect(page.getByText("Albert School", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Platform access")).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Overview" })).toBeVisible();

    // And the way out leads back to the console, with nothing of the customer left behind.
    await page.getByRole("button", { name: "Leave workspace" }).click();
    await page.waitForURL(/\/platform$/);
    await expect(page.getByText("Platform access")).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Overview" })).toHaveCount(0);
  });
});
