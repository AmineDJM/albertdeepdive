import { test, expect } from "@playwright/test";
import { ADMIN, login } from "./helpers";

/**
 * The customer's email screen: one field, plain words, and none of the provider's vocabulary.
 * Delivery is not connected on the test install, so the story ends where the screen says so.
 */
test.describe("email sending", () => {
  test("offers the domain in one field and explains the sender in plain words", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/settings/email");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Email sending");
    await expect(page.getByText("Sending as")).toBeVisible();
    for (const word of ["Resend", "DKIM", "API key", "webhook"]) await expect(page.locator("main").getByText(word, { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "Connect my domain" }).click();
    await page.getByLabel("Domain").fill("https://www.Acme.com/about");
    await expect(page.getByText("news.acme.com").first()).toBeVisible();
    await expect(page.getByText("newsletter@news.acme.com")).toBeVisible();

    await page.getByRole("button", { name: "Advanced settings" }).click();
    await page.getByRole("button", { name: "mail." }).click();
    await expect(page.getByText("mail.acme.com").first()).toBeVisible();

    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator("[data-sonner-toast]").last()).toContainText(/not connected/);
  });
});
