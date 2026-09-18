import { expect, type Page } from "@playwright/test";
import { one } from "./db";

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
  await page.waitForURL(/\/(overview|editions|admin)/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Standard or Advanced, set straight in the database before signing in.
 *
 * Every person starts in Standard, so a spec that asserts the full control room, the pulse or a
 * tab Standard keeps off the row says so first; a spec about Standard says that too, because one
 * worker runs every spec against the same account and the last choice sticks. The profile page's
 * own switch is exercised by the experience spec, through the interface.
 */
export async function setExperience(mode: "standard" | "advanced", email = ADMIN.email) {
  // The object goes as a parameter the driver serialises itself; a pre-stringified value would
  // arrive as a JSON string and turn the preferences into an array.
  await one(`update users set preferences = coalesce(preferences, '{}'::jsonb) || $1 where email = $2`, [{ experience: mode }, email]);
}
