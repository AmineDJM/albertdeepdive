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

  test("a new person starts in Standard: five places, one question, decisions on an edition", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    // Home answers one question.
    await expect(page.locator("main").getByText("What should I do now?")).toBeVisible();
    // No card above the newsletters restating one edition: the shelf is the answer.
    await expect(page.getByTestId("home-now")).toHaveCount(0);
    await expect(page.locator("main").getByText("Organization pulse", { exact: true })).toHaveCount(0);
    // The sidebar: Home, Analytics, Settings — and the newsletters themselves, each one the way into
    // its own editions, library, subscribers and contributors. The organisation-wide Library and
    // Audience are not there any more: a newsletter holds its own.
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Home", "Analytics", "Settings"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    for (const name of ["Content", "Brand", "Library", "Audience"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    await expect(page.getByTestId("sidebar-newsletters")).toBeVisible();
    // The card at the top is the organisation: switch, create one, or open your own account.
    await expect(page.getByTestId("organization-switcher")).toBeVisible();
    // Hidden from the sidebar, on the screen: the shelf, and the way to the whole list.
    await expect(page.locator("main").getByText("Your newsletters", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "All newsletters", exact: true })).toBeVisible();

    // An edition is its decisions, each with a Change.
    const edition = await one<{ id: string }>(`select id from editions where label = 'May 2025' limit 1`);
    await page.goto(`/editions/${edition!.id}`);
    await expect(page.locator("main").getByText("What Briefly decided", { exact: true })).toBeVisible();
    for (const label of ["Language", "Subscribers", "Publish date", "Outputs", "Contributors", "Topics", "Pictures", "Tone"]) await expect(page.locator("main").getByText(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Preview" })).toBeVisible();
    /*
     * The table is the edition's hub.
     *
     * Every row says whether it is settled (a green check) or still needs someone (an orange
     * circle), and Configure opens the page that sets it — with the way back to this table.
     */
    const decisions = page.getByTestId("decisions");
    await expect(decisions.getByRole("link", { name: /Configure|Manage|Add readers|See/ }).first()).toBeVisible();
    await expect(decisions.getByLabel("Set").first()).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Where this edition is" })).toHaveCount(0);
    // Back, top left, goes to the newsletter the edition belongs to.
    await expect(page.getByTestId("page-back")).toHaveAttribute("href", /\/publications\/[0-9a-f-]{36}$|\/overview$/);
    // One summary at the bottom: how many rows are still orange, and the way to publish.
    await expect(page.getByTestId("edition-readiness").getByRole("link", { name: "Publish" })).toHaveAttribute("href", `/editions/${edition!.id}/exports`);
    await expect(page.getByTestId("guided-next")).toHaveCount(0);

    // The control room is one link away, not gone.
    await page.getByRole("link", { name: "See the full control room" }).click();
    await expect(page.locator("main").getByText("Control room", { exact: true }).first()).toBeVisible();
    // …and the light view is one link back.
    await page.getByTestId("full-view-banner").getByRole("link", { name: "Back to the light view" }).click();
    await expect(page.locator("main").getByText("What Briefly decided", { exact: true })).toBeVisible();

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

  test("each row opens its page, and saving comes back to the table", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    const edition = await one<{ id: string }>(`select id from editions where label = 'May 2025' limit 1`);
    await page.goto(`/editions/${edition!.id}`);

    // Contributors → who are you asking, on its own page.
    await page.getByTestId("decisions").locator("li", { hasText: "Contributors" }).getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}/campaign$`));
    await expect(page.getByRole("heading", { name: "Who are you asking?" })).toBeVisible();
    await expect(page.locator("main").getByText("Email log")).toHaveCount(0);
    for (const way of ["A few of them", "A whole group", "People I choose"]) await expect(page.locator("main").getByText(way, { exact: true })).toBeVisible();

    // Back, top left, is the way to the table from any room of the edition.
    await expect(page.getByTestId("page-back")).toHaveAttribute("href", `/editions/${edition!.id}`);
    // Saving goes back to the table too.
    await page.getByTestId("guided-next-button").click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}$`));
    await expect(page.locator("main").getByText("What Briefly decided", { exact: true })).toBeVisible();

    // Pictures → the pictures, and back again.
    await page.getByTestId("decisions").locator("li", { hasText: "Pictures" }).getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}/media$`));
    await expect(page.getByRole("heading", { name: "Pictures" })).toBeVisible();
    await page.getByTestId("page-back").click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}$`));
  });

  test("the people are chosen by name, on the screen that asks who", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    // An issue whose invitation has not gone out: a closed campaign is read-only, on purpose.
    const upcoming = await one<{ id: string }>(
      `select e.id from editions e join submission_campaigns c on c.edition_id = e.id where c.status in ('DRAFT','SCHEDULED') order by e.created_at desc limit 1`,
    );
    await page.goto(`/editions/${upcoming!.id}/campaign`);
    await expect(page.getByRole("heading", { name: "Who are you asking?" })).toBeVisible();

    await expect(async () => {
      await page.getByRole("radio", { name: "People I choose" }).check();
      await expect(page.getByPlaceholder("Search a name or an address")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    // The names are here, and the search narrows them.
    const list = page.getByRole("listitem").filter({ has: page.getByRole("checkbox") });
    const before = await list.count();
    expect(before).toBeGreaterThan(1);
    await page.getByPlaceholder("Search a name or an address").fill("zzzzzz-nobody");
    await expect(page.locator("main").getByText("Nobody here by that name.")).toBeVisible();
  });

  test("Advanced opens every door from the profile, and Standard closes them again", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    await page.goto("/settings/profile");
    /*
     * Clicked until it answers.
     *
     * In development the markup arrives before React has hydrated, so a click that lands first
     * does nothing at all — and `aria-checked` is set by the handler, which means a single click
     * makes this spec a race against how fast this machine compiles rather than a test of the
     * switch.
     */
    await expect(async () => {
      await page.getByTestId("experience-advanced").click();
      await expect(page.getByTestId("experience-advanced")).toHaveAttribute("aria-checked", "true", { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Content", exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(nav.getByRole("link", { name: "Brand", exact: true })).toBeVisible();
    // The settings list grows to every page.
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Prompts", exact: true })).toBeVisible();

    await expect(async () => {
      await page.getByTestId("experience-standard").click();
      await expect(page.getByTestId("experience-standard")).toHaveAttribute("aria-checked", "true", { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await expect(nav.getByRole("link", { name: "Content", exact: true })).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: "Prompts", exact: true })).toHaveCount(0);
    // Nothing else moved: the switch is a preference, not a change to the workspace.
    const row = await one<{ preferences: { experience?: string } }>(`select preferences from users where email = 'admin@albertschool.com'`);
    expect(row!.preferences.experience).toBe("standard");
  });
});
