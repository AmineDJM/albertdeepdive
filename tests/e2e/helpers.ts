import { expect, type Page } from "@playwright/test";

/**
 * Two administrators, deliberately.
 *
 * `ADMIN` runs Albert School: a customer's editor in chief, owner of their workspace, with no view
 * of anyone else's. `PLATFORM_ADMIN` runs Briefly: no workspace of their own, the console as home,
 * and a customer's newsroom only when they open it on purpose. The seed creates both; the journey
 * tests use the first, the console tests the second.
 */
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "albert-deep-dive";

export const ADMIN = { email: "admin@albertschool.com", password: PASSWORD };
export const PLATFORM_ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@briefly.press", password: PASSWORD };

export async function login(page: Page, user = ADMIN) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(overview|editions|platform)/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
