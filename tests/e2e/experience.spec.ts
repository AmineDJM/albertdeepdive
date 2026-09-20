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
    await expect(page.getByTestId("home-now")).toBeVisible();
    await expect(page.locator("main").getByText("Organization pulse", { exact: true })).toHaveCount(0);
    // The sidebar: Home, Library — Audience, Analytics, Settings. No Content, no Brand, and no
    // Newsletters either: they are the first thing on Home, each title with the edition being made
    // and the button that starts the next, so a sidebar entry to the same titles was one thing in
    // two places.
    const nav = page.getByRole("navigation", { name: "Main" });
    for (const name of ["Home", "Library", "Audience", "Analytics", "Settings"]) await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    for (const name of ["Content", "Brand", "Newsletters"]) await expect(nav.getByRole("link", { name, exact: true })).toHaveCount(0);
    // Hidden from the sidebar, on the screen: the shelf, and the way to the whole list.
    await expect(page.locator("main").getByText("Your newsletters", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "All newsletters", exact: true })).toBeVisible();

    // An edition is its decisions, each with a Change.
    const edition = await one<{ id: string }>(`select id from editions where label = 'May 2025' limit 1`);
    await page.goto(`/editions/${edition!.id}`);
    await expect(page.locator("main").getByText("What Briefly decided", { exact: true })).toBeVisible();
    for (const label of ["Language", "Audience", "Publish date", "Outputs", "Contributors", "Stories", "Pictures", "Tone"]) await expect(page.locator("main").getByText(label, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Preview" })).toBeVisible();
    // Who was asked is a decision like any other, and it opens the screen that sets it.
    await expect(page.locator("main").getByRole("link", { name: /Set up|Change|See/ }).first()).toBeVisible();
    /*
     * No bar above the page at all.
     *
     * There were two rows here once, then one: five steps that said "Contributors" while the page
     * under them showed the topics. A progress bar that has to disagree with its own screen is a
     * second opinion, not navigation, so Standard has neither — the decisions below are the map
     * and the button at the bottom is what comes next.
     */
    await expect(page.getByRole("navigation", { name: "Sections" })).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Where this edition is" })).toHaveCount(0);
    // The edition's name in the header is the way back to this screen from any room in it.
    await expect(page.getByRole("link", { name: /Edition #\d+/ })).toHaveAttribute("href", `/editions/${edition!.id}`);
    /*
     * One button at the bottom, and it goes forward.
     *
     * The screen used to end twice: "Look at what came in" above the decisions and "Publish" below
     * them, with eight "Change" links in between — three answers to "and now?" on one page.
     */
    const forward = page.getByTestId("guided-next");
    await expect(forward.getByRole("link", { name: /Validate/ })).toHaveAttribute("href", `/editions/${edition!.id}/ask`);
    await expect(page.locator("main").getByText("Happy with it?")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Look at what came in" })).toHaveCount(0);

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

  test("the path leads from the edition to the pictures, one button at a time", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    const edition = await one<{ id: string }>(`select id from editions where label = 'May 2025' limit 1`);
    await page.goto(`/editions/${edition!.id}`);

    // Validate → what are you asking for.
    await page.getByTestId("guided-next").getByRole("link", { name: /Validate/ }).click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}/ask$`));
    await expect(page.getByRole("heading", { name: "What are you asking for?" })).toBeVisible();
    // The word at the top of the invitation is asked here, beside the questions it introduces.
    await expect(page.locator("main").getByText("Anything to tell them?")).toBeVisible();

    // Next → who are you asking. The campaign screen asks the question rather than showing the
    // phase timeline, six counters, a coverage table and an email log.
    await page.getByTestId("guided-next-button").click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}/campaign$`));
    await expect(page.getByRole("heading", { name: "Who are you asking?" })).toBeVisible();
    await expect(page.locator("main").getByText("Email log")).toHaveCount(0);
    await expect(page.locator("main").getByText("Coverage", { exact: true })).toHaveCount(0);
    // Three ways of choosing, and none of them sends you somewhere else to do it.
    for (const way of ["A few of them", "A whole group", "People I choose"]) await expect(page.locator("main").getByText(way, { exact: true })).toBeVisible();
    await expect(page.locator("main").getByText("Pick them on the contributors screen")).toHaveCount(0);

    // Next → when for, which is now a screen and not a field under the people.
    await page.getByTestId("guided-next-button").click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}/deadline$`));
    await expect(page.getByRole("heading", { level: 1, name: "When for?" })).toBeVisible();
    // The reminders and the day of grace are shown, because they follow from the date.
    await expect(page.locator("main").getByText("First reminder")).toBeVisible();

    // And the way back, which the path had no button for at all.
    await page.getByTestId("guided-back-button").click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}/campaign$`));
    await page.getByTestId("guided-next-button").click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}/deadline$`));

    // Next → the pictures, which are the pictures.
    await page.getByTestId("guided-next-button").click();
    await expect(page).toHaveURL(new RegExp(`/editions/${edition!.id}/media$`));
    await expect(page.getByRole("heading", { name: "Pictures" })).toBeVisible();
    await expect(page.locator("main").getByText("Duplicates", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Describe/ })).toHaveCount(0);

    // And on to the topics, which is where the timeline's second step also goes.
    await expect(page.getByTestId("guided-next").getByRole("link", { name: /Next/ })).toHaveAttribute("href", `/editions/${edition!.id}/topics`);
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
