import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * The interface follows the person's language. A campus editor switches to French and the
 * newsroom reads in French — headings, navigation, buttons — then switches back, so the rest of
 * the suite, written against the English words, finds them where it expects.
 */
const LYON = { email: "lyon@albertschool.com", password: process.env.SEED_ADMIN_PASSWORD ?? "albert-deep-dive" };

test.describe("the French interface", () => {
  test("switching the language translates the newsroom, and switching back restores it", async ({ page }) => {
    await login(page, LYON);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Overview|Good (morning|afternoon|evening)/);

    // The picker lives in the account menu, under the avatar.
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByLabel("Interface language").selectOption("fr");
    // The open menu hides the rest of the page from the accessibility tree; close it first.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Vue d'ensemble|Bonjour|Bon après-midi|Bonsoir/);
    // The hub is "Parutions" in the sidebar. It opens the titles, not a second list of editions:
    // Home already opens on the issue being made and the recent ones.
    await page.getByRole("link", { name: "Parutions", exact: true }).click();
    await expect(page).toHaveURL(/\/publications$/);
    await expect(page.getByRole("heading", { name: "Publications" }).first()).toBeVisible();

    // The editions list is still there, one drill-down away, and still in French.
    await page.goto("/editions");
    await expect(page.getByRole("heading", { name: "Éditions" })).toBeVisible();
    await expect(page.locator("main").getByText(/Une édition par mois|Chaque édition, et où elle en est/)).toBeVisible();

    await page.getByRole("button", { name: "Menu du compte" }).click();
    await page.getByLabel("Interface language").selectOption("en");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Editions" })).toBeVisible();
  });
});
