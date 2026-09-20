import { test, expect } from "@playwright/test";
import { closeDb, one } from "./db";
import { login, setExperience } from "./helpers";

/**
 * The list, out and in.
 *
 * A directory you can read and not take away is one somebody retypes by hand, and a newsroom that
 * already has four hundred readers will not ask them to sign up again. So both lists export, and
 * readers can be added one at a time or brought in from a spreadsheet whose columns the publisher
 * matches themselves.
 */
test.describe.configure({ mode: "serial" });

test.describe("the audience", () => {
  test.afterAll(async () => {
    await closeDb();
  });

  test("both lists come out as a file you can open", async ({ page }) => {
    await setExperience("advanced");
    await login(page);

    for (const what of ["subscribers", "contributors"]) {
      const response = await page.request.get(`/api/audience/export?what=${what}`);
      expect(response.status(), what).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/csv");
      expect(response.headers()["content-disposition"]).toMatch(new RegExp(`attachment; filename="${what}-\\d{4}-\\d{2}-\\d{2}.csv"`));
      const body = await response.text();
      // The mark that makes Excel read it as UTF-8, then a header row naming the columns.
      expect(body.charCodeAt(0), what).toBe(0xfeff);
      expect(body.split("\r\n")[0], what).toContain("Email");
    }
  });

  test("a stranger cannot take the list", async ({ request }) => {
    // The `request` fixture carries no session, unlike `page.request`, which shares the browser's.
    // A door with no session behind it sends you to sign in rather than handing over the file.
    const response = await request.get("/api/audience/export?what=subscribers", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(response.headers().location).toContain("/login");
  });

  test("a reader can be added by hand, and lands on the list", async ({ page }) => {
    await setExperience("advanced");
    await login(page);
    await page.goto("/subscribers");
    await expect(page.getByRole("heading", { level: 1, name: "Subscribers" })).toBeVisible();

    const address = `e2e.reader.${Date.now()}@example.test`;
    await expect(async () => {
      await page.getByRole("button", { name: "Add a reader" }).click();
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByLabel("Email", { exact: true }).fill(address);
    await page.getByLabel("First name").fill("Marie");
    await page.getByLabel("Last name").fill("Dupont");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.locator("main").getByText(address)).toBeVisible({ timeout: 30_000 });
    const row = await one<{ status: string; source: string }>(`select status::text, source from subscribers where email = $1`, [address]);
    expect(row).toMatchObject({ status: "SUBSCRIBED", source: "by-hand" });
  });

  test("a spreadsheet is matched by hand before anything is written", async ({ page }) => {
    await setExperience("advanced");
    await login(page);
    await page.goto("/subscribers/import");
    await expect(page.getByRole("heading", { level: 1, name: "Import readers" })).toBeVisible();
    await expect(page.locator("main").getByText("The first row must name the columns", { exact: false })).toBeVisible();

    const stamp = Date.now();
    const csv = `Prénom,Nom,Adresse e-mail,Langue\nJean,Martin,jean.${stamp}@example.test,Français\nLéa,Bernard,lea.${stamp}@example.test,English\n`;
    await expect(async () => {
      await page.locator('input[type="file"]').setInputFiles({ name: "readers.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
      await expect(page.locator("main").getByText("Which column is what")).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000 });

    // The guess is a suggestion on a form: the address column is already chosen, and can be changed.
    await expect(page.getByLabel("Email", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "See what will happen" }).click();

    await expect(page.locator("main").getByText("Nothing has been written yet.")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("main").getByText("2 to add")).toBeVisible();
    // And nothing is in the database until the last button is pressed.
    expect(await one<{ n: string }>(`select count(*)::text as n from subscribers where email like $1`, [`%.${stamp}@example.test`])).toMatchObject({ n: "0" });

    await page.getByRole("button", { name: "Import them" }).click();
    await expect(page.locator("main").getByText("Every row went in.")).toBeVisible({ timeout: 60_000 });
    expect(await one<{ n: string }>(`select count(*)::text as n from subscribers where email like $1`, [`%.${stamp}@example.test`])).toMatchObject({ n: "2" });
  });
});
