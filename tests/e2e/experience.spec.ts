import { test, expect } from "@playwright/test";
import { closeDb, one } from "./db";
import { login, setExperience } from "./helpers";

/**
 * The Standard experience, as a person meets it.
 *
 * Signed in for the first time, the sidebar is six words, Home is one sentence and one button,
 * an edition is a short list of decisions, and one click makes the next edition. Switching to
 * Advanced on the profile opens every door, and switching back closes them again with nothing
 * else changed.
 */
test.describe("standard and advanced", () => {
  test.afterAll(async () => {
    await setExperience("standard");
    await closeDb();
  });

  test("a new person starts in Standard: six places, one question, decisions on an edition", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    // Home answers one question.
    await expect(page.locator("main").getByText("What should I do now?")).toBeVisible();
    await expect(page.getByTestId("home-now")).toBeVisible();
    await expect(page.locator("main").getByText("Organization pulse", { exact: true })).toHaveCount(0);
    // The sidebar: Home, Newsletters, Library — Audience, Analytics, Settings. No Content, no Brand.
    // "Newsletters" rather than "Editions" because that section holds the titles, and an edition
    // lives inside one of them.
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Home", "Newsletters", "Library", "Audience", "Analytics", "Settings"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Content", exact: true })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Brand", exact: true })).toHaveCount(0);

    // An edition is its decisions, each with a Change.
    const edition = await one<{ id: string }>(`select id from editions where label = 'May 2025' limit 1`);
    await page.goto(`/editions/${edition!.id}`);
    await expect(page.locator("main").getByText("What Briefly decided", { exact: true })).toBeVisible();
    for (const label of ["Language", "Audience", "Publish date", "Outputs", "Stories", "Pictures", "Tone"]) await expect(page.locator("main").getByText(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Preview" })).toBeVisible();
    // Four doors, in plain words.
    const doors = page.getByRole("navigation", { name: "Sections" }).first();
    await expect(doors.getByRole("link", { name: "Pictures", exact: true })).toBeVisible();
    await expect(doors.getByRole("link", { name: "Publish", exact: true })).toBeVisible();
    await expect(doors.getByRole("link", { name: "Design", exact: true })).toHaveCount(0);
    // The control room is one link away, not gone.
    await page.getByRole("link", { name: "See the full control room" }).click();
    await expect(page.locator("main").getByText("Control room", { exact: true }).first()).toBeVisible();

    // Settings reads as one line per thing.
    await page.goto("/settings");
    await expect(page.getByTestId("settings-overview")).toBeVisible();
    await expect(page.getByTestId("settings-overview").getByText("Email sending", { exact: true })).toBeVisible();
  });

  test("one click prepares the next edition and opens it", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    await page.goto("/editions");
    const before = await one<{ n: string }>(`select count(*)::text as n from editions`);
    await page.getByTestId("new-edition").click();
    await expect(page).toHaveURL(/\/editions\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.locator("main").getByText("What Briefly decided", { exact: true })).toBeVisible();
    const after = await one<{ n: string }>(`select count(*)::text as n from editions`);
    expect(Number(after!.n)).toBe(Number(before!.n) + 1);
    // Prepared, not just created: the month after the latest, sections, dates, a campaign.
    const made = await one<{ id: string; label: string; campaigns: string; sections: string }>(
      `select e.id, e.label,
              (select count(*)::text from submission_campaigns c where c.edition_id = e.id) as campaigns,
              (select count(*)::text from edition_sections s where s.edition_id = e.id) as sections
       from editions e order by e.created_at desc limit 1`,
    );
    expect(Number(made!.sections)).toBeGreaterThan(0);
    expect(Number(made!.campaigns)).toBe(1);
    await one(`delete from editions where id = $1`, [made!.id]);
  });

  test("Advanced opens every door from the profile, and Standard closes them again", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    await page.goto("/settings/profile");
    await page.getByTestId("experience-advanced").click();
    await expect(page.getByTestId("experience-advanced")).toHaveAttribute("aria-checked", "true");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Content", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByRole("link", { name: "Brand", exact: true })).toBeVisible();
    // The settings list grows to every page.
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Prompts", exact: true })).toBeVisible();

    await page.getByTestId("experience-standard").click();
    await expect(page.getByTestId("experience-standard")).toHaveAttribute("aria-checked", "true");
    await expect(nav.getByRole("link", { name: "Content", exact: true })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Prompts", exact: true })).toHaveCount(0);
    // Nothing else moved: the switch is a preference, not a change to the workspace.
    const row = await one<{ preferences: { experience?: string } }>(`select preferences from users where email = 'admin@albertschool.com'`);
    expect(row!.preferences.experience).toBe("standard");
  });
});
