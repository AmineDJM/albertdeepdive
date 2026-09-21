import { test, expect } from "@playwright/test";
import { ADMIN, login } from "./helpers";
import { one } from "./db";

/**
 * Who the organisation is, and the fact that every word of it can be corrected by hand.
 *
 * The reading pass is not exercised here — it opens somebody else's website, which a test suite
 * has no business doing — but the half that matters to a customer is: everything it would propose
 * has a field, that field can be typed into, and what is typed is what gets saved.
 */
test.describe("the workspace's own details", () => {
  test("takes the organisation's details by hand and keeps them", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/settings/workspace");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Workspace");

    await page.getByLabel("Legal name").fill("Albert School SAS");
    await page.getByLabel("Industry").fill("Education");
    await page.getByLabel("Founded").fill("2021");
    await page.getByLabel("Contact email").fill("bonjour@albertschool.com");
    await page.getByLabel("Telephone").fill("+33 1 76 42 00 00");
    await page.getByLabel("Address").fill("5 rue de la Paix, 75002 Paris");
    await page.getByLabel("LinkedIn").fill("https://www.linkedin.com/school/albert-school");

    await page.getByRole("button", { name: /save workspace/i }).click();
    await expect(page.locator("[data-sonner-toast]").last()).toBeVisible();

    const row = await one<{ profile: Record<string, unknown>; links: Record<string, unknown> }>(
      `select settings->'profile' as profile, links from organizations where slug = 'albert-school'`,
    );
    expect(row?.profile).toMatchObject({
      legalName: "Albert School SAS",
      industry: "Education",
      foundedYear: 2021,
      email: "bonjour@albertschool.com",
      address: "5 rue de la Paix, 75002 Paris",
    });
    expect(row?.links).toMatchObject({ linkedin: "https://www.linkedin.com/school/albert-school" });

    // What was saved is what comes back, so the next person sees it and can change it again.
    await page.reload();
    await expect(page.getByLabel("Legal name")).toHaveValue("Albert School SAS");
    await expect(page.getByLabel("Founded")).toHaveValue("2021");
  });

  test("offers to read the website, and says so before anything is written", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/settings/workspace");
    const reread = page.getByRole("button", { name: "Read my website again" });
    await expect(reread).toBeVisible();
    await expect(page.getByText("We open your site in a browser and bring back what it says about you.")).toBeVisible();
  });
});
