import { test, expect } from "@playwright/test";
import { login } from "./helpers";

/**
 * The interface follows the person's language. A campus editor switches to French and the
 * newsroom reads in French — headings, navigation, buttons — then switches back, so the rest of
 * the suite, written against the English words, finds them where it expects.
 */
const LYON = { email: "lyon@albertschool.com", password: process.env.SEED_ADMIN_PASSWORD ?? "briefly-demo" };

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
    // The newsletters are on Home, as the shelf, and "Toutes les newsletters" opens the full list.
    // They left the sidebar because a second entry leading to the same titles is a second place to
    // look for one thing — and they are still one click from where a person lands.
    await expect(page.locator("main").getByText("Vos newsletters", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Toutes les newsletters", exact: true }).click();
    await expect(page).toHaveURL(/\/publications$/);
    await expect(page.getByRole("heading", { name: "Newsletters" }).first()).toBeVisible();
    await expect(page.locator("main").getByText(/titres récurrents/i), "and everything around it is French").toBeVisible();

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
