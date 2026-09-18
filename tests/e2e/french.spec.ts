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
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Vue d'ensemble|Bonjour|Bon après-midi|Bonsoir/);
    await page.keyboard.press("Escape");
    // The hub is "Parutions" in the sidebar; the list it opens is titled "Éditions".
    await page.getByRole("link", { name: "Parutions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Éditions" })).toBeVisible();
    await expect(page.locator("main").getByText("Une édition par mois. Les numéros spéciaux sont bienvenus.")).toBeVisible();

    await page.getByRole("button", { name: "Menu du compte" }).click();
    await page.getByLabel("Interface language").selectOption("en");
    await expect(page.getByRole("heading", { name: "Editions" })).toBeVisible();
  });
});
