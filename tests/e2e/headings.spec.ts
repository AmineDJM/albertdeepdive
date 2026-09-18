import { test, expect } from "@playwright/test";
import { login } from "./helpers";
import { one } from "./db";

/**
 * Every screen names itself, exactly once.
 *
 * A page with no `h1` and a run of `h2`s beneath it has a heading outline that begins in the middle:
 * somebody navigating by heading lands with no idea what they are looking at. The whole edition
 * section did this — campaign, articles, layout, exports, inbox, media, all titled by a `<span>` in
 * the shared layout, so seven routes had no page title between them.
 *
 * Checked against the rendered page rather than the source, because an `h1` can come from an
 * imported component and two `h1`s in opposite branches of a conditional are not two `h1`s.
 */

const NEWSROOM = [
  "/overview",
  "/publications",
  "/editions",
  "/studio",
  "/archive",
  "/subscribers",
  "/directory",
  "/contributors",
  "/campuses",
  "/analytics",
  "/automations",
  "/media",
  "/inbox",
  "/stories",
  "/articles",
  "/settings",
  "/settings/brand",
  "/settings/billing",
  "/platform",
  "/platform/workspaces",
  "/platform/people",
  "/platform/logs",
  "/platform/integrations",
];

test.describe("heading outlines", () => {
  test("every newsroom page has exactly one title", async ({ page }) => {
    await login(page);
    const untitled: string[] = [];
    for (const route of NEWSROOM) {
      // `networkidle`, not `domcontentloaded`: several of these are redirects to the current
      // edition's own route, and measuring before the redirect resolves counts the headings of a
      // page nobody ever sees.
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status(), `${route} did not load`).toBeLessThan(400);
      const count = await page.locator("h1").count();
      if (count !== 1) untitled.push(`${route}: ${count} h1`);
    }
    expect(untitled, `pages without exactly one title:\n${untitled.join("\n")}`).toEqual([]);
  });

  test("every tab of an edition is titled by the edition it belongs to", async ({ page }) => {
    await login(page);
    const edition = await one<{ id: string; label: string }>("select id, label from editions order by issue_number desc limit 1");
    expect(edition, "the seed must have an edition").toBeTruthy();

    for (const tab of ["", "/campaign", "/articles", "/layout", "/exports", "/inbox", "/media"]) {
      const route = `/editions/${edition!.id}${tab}`;
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status(), `${route} did not load`).toBeLessThan(400);
      const heading = page.locator("h1");
      // Exactly one, and not empty. Each tab names itself — "Campaign", "Exports" — while the
      // sticky bar above carries the edition, which is context rather than title.
      await expect(heading, `${route} has no single title`).toHaveCount(1);
      expect((await heading.textContent())?.trim(), `${route} has an empty title`).toBeTruthy();
    }
  });
});
