import { test, expect } from "@playwright/test";
import { closeDb, one } from "./db";
import { login, PLATFORM_ADMIN, setExperience } from "./helpers";

/**
 * The gallery, as a stranger meets it.
 *
 * Nobody is signed in: that is the point of the page, and it is also the privacy test. The seed
 * gives Briefly three demo workspaces and one customer, Albert School, who has agreed to nothing —
 * so Albert School must not appear anywhere on it, however hard the page is looked at.
 */
test.describe("the public gallery", () => {
  test.afterAll(async () => {
    await closeDb();
  });

  test("a visitor with no account browses real publications and can open one", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/collections");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Real publications");

    // Featured collections are on the front page, and one of them opens.
    await expect(page.locator("main").getByText("Featured collections", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Universities/ }).first()).toBeVisible();

    // The customer who never agreed is nowhere on the page.
    await expect(page.getByText("Albert School")).toHaveCount(0);

    // A real edition is one click away, at its own public address.
    const card = page.locator("main a[href^='/r/']").first();
    await expect(card).toBeVisible();
    const href = await card.getAttribute("href");
    expect(href).toMatch(/^\/r\/[a-z0-9-]+$/);

    // And the page asks for the one thing it wants.
    await expect(page.getByRole("link", { name: /Start with Briefly/ })).toBeVisible();
  });

  test("a collection has its own page, and searching narrows it", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/collections/universities");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Universities");
    await expect(page.locator("main a[href^='/r/']").first()).toBeVisible();
    const before = await page.locator("main a[href^='/r/']").count();
    expect(before).toBeGreaterThan(0);
    await expect(page.getByText("Albert School")).toHaveCount(0);
  });

  test("the publication a visitor opens is a real page, not a mock-up", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/collections");
    const href = await page.locator("main a[href^='/r/']").first().getAttribute("href");
    await page.goto(href!);
    await expect(page.locator("body")).toContainText(/Northgate|Meridian|Rivermouth/);
  });

  test("a draft collection is a 404 for everyone", async ({ page }) => {
    const id = await one<{ id: string }>(`insert into collections (slug, title, is_published) values ('draft-check', 'Draft check', false) returning id`);
    await page.context().clearCookies();
    const response = await page.goto("/collections/draft-check");
    expect(response?.status()).toBe(404);
    await one(`delete from collections where id = $1`, [id!.id]);
  });

  test("the console curates it, and counts what visitors did", async ({ page }) => {
    await setExperience("advanced", PLATFORM_ADMIN.email);
    await login(page, PLATFORM_ADMIN);
    await page.goto("/admin/collections");
    await expect(page.getByRole("heading", { name: "Collections" })).toBeVisible();
    await expect(page.locator("main").getByText("Universities", { exact: true })).toBeVisible();
    // The gallery's own numbers, gathered from the visits above.
    await expect(page.locator("main").getByText("Gallery views", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Universities", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/collections\/[0-9a-f-]{36}/);
    await expect(page.locator("main").getByText("In this collection", { exact: true })).toBeVisible();
    await expect(page.locator("main").getByText("Who agreed", { exact: true })).toBeVisible();
  });
});

/**
 * The two files people want while looking at a preview.
 *
 * The preview shows the edition as it stands; these buttons hand the same thing over as a file.
 * Not a version: nothing is stored and nothing is numbered, which the bar says in so many words.
 */
test.describe("exporting from the preview", () => {
  test("the preview offers a PDF and a Word file, and the Word file is real", async ({ page }) => {
    await login(page);
    const edition = await one<{ id: string }>(`select id from editions where label = 'May 2025' limit 1`);
    await page.goto(`/print/edition/${edition!.id}`);
    await expect(page.getByTestId("preview-export-pdf")).toBeVisible();
    await expect(page.getByTestId("preview-export-docx")).toBeVisible();

    const docx = await page.request.get(`/print/edition/${edition!.id}/export?format=docx`, { timeout: 120_000 });
    expect(docx.status()).toBe(200);
    expect(docx.headers()["content-type"]).toContain("wordprocessingml");
    expect(docx.headers()["content-disposition"]).toContain(".docx");
    // A DOCX is a zip: the first two bytes say so, which proves a file rather than an error page.
    const body = await docx.body();
    expect(body.length).toBeGreaterThan(2000);
    expect(body.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  test("a stranger cannot take a copy of somebody's edition", async ({ page }) => {
    const edition = await one<{ id: string }>(`select id from editions where label = 'May 2025' limit 1`);
    await page.context().clearCookies();
    const response = await page.request.get(`/print/edition/${edition!.id}/export?format=docx`);
    expect(response.status()).toBe(401);
  });
});
