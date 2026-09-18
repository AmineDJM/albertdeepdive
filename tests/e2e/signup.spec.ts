import { test, expect } from "@playwright/test";
import { many, one } from "./db";

/**
 * "Start for free" on the marketing site used to land on the sign-in page, where somebody with no
 * account had nothing to do. This walks the door the landing page now opens: the form, the account
 * it creates, the workspace step it hands you to, and the refusal when the address is taken.
 */
test.describe("signing up", () => {
  const email = `e2e-signup-${Date.now()}@example.com`;
  const password = "briefly-e2e-passphrase";

  test.afterAll(async () => {
    const user = await one<{ id: string }>(`select id from users where email = $1`, [email]);
    if (!user) return;
    await many(`delete from sessions where user_id = $1`, [user.id]);
    await many(`delete from audit_log where user_id = $1`, [user.id]);
    await many(`delete from users where id = $1`, [user.id]);
  });

  test("the landing page's free trial leads to the form, and the form creates an account", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await page.getByRole("link", { name: /start for free/i }).first().click();
    await expect(page).toHaveURL(/\/signup/);
    await expect(page.getByRole("heading", { name: "Start for free" })).toBeVisible();

    await page.getByLabel("Your name").fill("Alex from the E2E suite");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Password again").fill(password);
    await page.getByTestId("signup-submit").click();

    // A new account has no workspace yet, so it lands on the step that makes one.
    await page.waitForURL(/\/onboarding/);
    const row = await one<{ role: string; is_active: boolean }>(`select role, is_active from users where email = $1`, [email]);
    expect(row?.role).toBe("EDITOR_IN_CHIEF");
    expect(row?.is_active).toBe(true);
  });

  test("a second account on the same address is refused and points at signing in", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/signup");
    await page.getByLabel("Your name").fill("Someone else");
    await page.getByLabel("Work email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Password again").fill(password);
    await page.getByTestId("signup-submit").click();
    await expect(page.getByText(/already registered/i)).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
    const count = await one<{ n: string }>(`select count(*)::text as n from users where email = $1`, [email]);
    expect(count?.n).toBe("1");
  });

  test("the sign-in page offers the way in for someone without an account", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByRole("link", { name: /start for free/i }).click();
    await expect(page).toHaveURL(/\/signup/);
  });
});
