import { test, expect } from "@playwright/test";
import { closeDb, one } from "./db";

/**
 * The two public doors, as a stranger meets them.
 *
 * Nobody signed in: these pages belong to the newsletter, not to the newsroom, and the whole
 * point of them is that somebody who has never heard of Briefly can use them.
 */
test.describe("the public links", () => {
  test.afterAll(async () => {
    await closeDb();
  });

  test("a reader subscribes to one newsletter from its own link", async ({ page }) => {
    const title = await one<{ subscribe_slug: string; name: string }>(`select subscribe_slug, name from publications where subscribe_slug is not null limit 1`);
    await page.goto(`/s/${title!.subscribe_slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title!.name);
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  test("a reader picks the newsletters they want from the one link", async ({ page }) => {
    const org = await one<{ slug: string; name: string }>(
      `select o.slug, o.name from organizations o join publications p on p.organization_id = o.id where p.is_public and p.subscribe_slug is not null limit 1`,
    );
    await page.goto(`/s/all/${org!.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(org!.name);
    // A tick box per newsletter, and nothing can be sent until one is ticked.
    const boxes = page.locator('input[name="publicationIds"]');
    expect(await boxes.count()).toBeGreaterThan(0);

    const email = `e2e.shelf.${Date.now()}@example.test`;
    await expect(async () => {
      await boxes.first().check();
      await expect(boxes.first()).toBeChecked({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: /Subscribe|S'abonner/ }).click();

    await expect(page.locator("main").getByText(/inbox|boîte/i)).toBeVisible({ timeout: 30_000 });
    // Pending, because a subscription is double opt-in whichever door it came through.
    const row = await one<{ status: string }>(`select status::text from subscribers where email = $1`, [email]);
    expect(row).toMatchObject({ status: "PENDING" });
  });

  test("somebody offers to write, and lands in the contributor list", async ({ page }) => {
    const title = await one<{ join_slug: string; name: string }>(`select join_slug, name from publications where join_slug is not null limit 1`);
    await page.goto(`/c/${title!.join_slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(title!.name);

    const email = `e2e.writer.${Date.now()}@example.test`;
    await page.getByLabel("First name").fill("Paul");
    await page.getByLabel("Last name").fill("Petit");
    await page.getByLabel("Email").fill(email);

    /*
     * Pressed until it is heard, and checked on the words only the answer says.
     *
     * The button reads "Put me on the list", so asserting "on the list" passed against the button
     * itself and the test proved nothing at all while the form had not been submitted. The reply
     * is the only place that says what happens next.
     */
    await expect(async () => {
      await page.getByRole("button", { name: /Put me on the list|Inscrivez-moi/i }).click();
      await expect(page.locator("main").getByText(/hear from us|de nos nouvelles/i)).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
    const row = await one<{ is_active: boolean }>(`select is_active from contributors where email = $1`, [email]);
    expect(row).toMatchObject({ is_active: true });
    // And attached to the newsletter they followed the link from.
    const link = await one<{ n: string }>(
      `select count(*)::text as n from publication_contributors pc join contributors c on c.id = pc.contributor_id where c.email = $1`,
      [email],
    );
    expect(link).toMatchObject({ n: "1" });
  });
});
