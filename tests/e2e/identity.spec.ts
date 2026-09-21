import { test, expect } from "@playwright/test";
import { ADMIN, login } from "./helpers";
import { one } from "./db";

/**
 * Who you are, and where you belong.
 *
 * `users.username` shipped as a column with a unique index and no way to fill it — no field, no
 * screen, nothing reading it. And the only place that listed a person's organisations was the
 * switcher in the sidebar, which says where you are and not what you are allowed to do there.
 */
test.describe("your account and your organisations", () => {
  test("claims a username, and refuses one that is not a handle", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/settings/profile");

    const field = page.getByLabel("Username");
    await expect(field).toBeVisible();
    await field.fill("Albert.School.Admin");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("[data-sonner-toast]").last()).toBeVisible();

    // Stored in one spelling, whatever was typed.
    const row = await one<{ username: string }>(`select username from users where email = $1`, [ADMIN.email]);
    expect(row?.username).toBe("albert.school.admin");

    await field.fill("settings");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("main").getByText("kept for Briefly itself")).toBeVisible();
    const unchanged = await one<{ username: string }>(`select username from users where email = $1`, [ADMIN.email]);
    expect(unchanged?.username).toBe("albert.school.admin");
  });

  test("lists the organisations you belong to, and your role in each", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/settings/organizations");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your organisations");
    await expect(page.getByRole("main").getByText("Albert School", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText(/Your role: (owner|admin|editor|viewer|contributor)/).first()).toBeVisible();
    await expect(page.getByRole("main").getByText("You are here")).toBeVisible();
    await expect(page.getByRole("link", { name: "New organisation" })).toBeVisible();
  });
});
