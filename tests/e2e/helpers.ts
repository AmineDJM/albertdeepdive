import { expect, type Page } from "@playwright/test";

export const ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@briefly.press", password: process.env.SEED_ADMIN_PASSWORD ?? "albert-deep-dive" };

export async function login(page: Page, user = ADMIN) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(overview|editions)/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
