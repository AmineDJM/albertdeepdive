import { test, expect } from "@playwright/test";
import { closeDb, one } from "./db";
import { login, setExperience } from "./helpers";

/**
 * The model a newsletter is made on.
 *
 * Two ways in and one promise: nothing is written until somebody says so. Reading a file somebody
 * uploaded is not agreeing to it, which is why the reading appears on screen first and the title
 * only changes when the button is pressed.
 */
test.describe.configure({ mode: "serial" });

test.describe("the model", () => {
  let publicationId: string;
  let before: { id: string } | null = null;

  test.beforeAll(async () => {
    const row = await one<{ id: string }>(`select id from publications order by created_at limit 1`);
    expect(row, "the seed has a newsletter").toBeTruthy();
    publicationId = row!.id;
    before = await one(`select id from publication_identities where publication_id = $1 and is_active = true`, [publicationId]);
  });

  test.afterAll(async () => {
    /*
     * An identity is versioned rather than overwritten, so the rows this test made are removed and
     * whatever was active before it ran is made active again. Deleting the lot would leave the
     * title without the identity another spec may be composing against.
     */
    await one(`delete from publication_identities where publication_id = $1 and identity->'source' is not null and identity->'source'->>'kind' <> 'hand'`, [publicationId]);
    if (before) await one(`update publication_identities set is_active = (id = $2) where publication_id = $1`, [publicationId, before.id]);
    await closeDb();
  });

  test("reads a newsletter somebody already has, and changes nothing until they say so", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    await page.goto(`/publications/${publicationId}/blueprint`);
    await expect(page.getByRole("heading", { level: 1, name: "The model" })).toBeVisible();

    // An email export: the most legible format there is, and one a test can write by hand.
    const html = [
      "<!doctype html><html><head><style>",
      '  body { font-family: "Source Sans Pro", sans-serif; color: #111111; }',
      "  .wrap { max-width: 600px; }",
      "  h1 { font-family: 'Playfair Display', serif; color: #c8102e; }",
      "  .rule { border-top: 2px solid #c8102e; } .tag { color: #C8102E; }",
      "</style></head><body><div class='wrap'>",
      "<h1>The Acme Letter</h1><h2>Editor's note</h2><p>Hello everyone, here is this month.</p>",
      "<h2>The numbers</h2><p>Three hundred and twelve sign-ups.</p>",
      "</div></body></html>",
    ].join("\n");

    await expect(async () => {
      await page.locator('input[type="file"]').setInputFiles({ name: "campaign.html", mimeType: "text/html", buffer: Buffer.from(html) });
      await expect(page.getByText("What Briefly understood")).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 60_000 });

    // What it measured, shown before anything is decided.
    await expect(page.getByTestId("blueprint-colours")).toContainText("#c8102e");
    await expect(page.getByTestId("blueprint-rubrics")).toBeVisible();
    // The rubrics are the source's own words, and last month's copy is nowhere.
    await expect(page.getByTestId("blueprint-rubrics")).not.toContainText("sign-ups");
    const rubrics = page.getByTestId("blueprint-rubrics").getByRole("textbox");
    await expect(rubrics.first()).toHaveValue(/Acme Letter|Editor|numbers/);

    // Nothing has been written: reading is not adopting.
    const untouched = await one<{ n: string }>(`select count(*)::text as n from publication_identities where publication_id = $1 and identity->'source'->>'kind' = 'uploaded'`, [publicationId]);
    expect(untouched!.n).toBe("0");

    await page.getByTestId("blueprint-adopt").click();
    await expect(page.getByText("What this newsletter is made on")).toBeVisible({ timeout: 15_000 });

    const adopted = await one<{ file: string; kind: string }>(
      `select identity->'source'->>'fileName' as file, identity->'source'->>'kind' as kind from publication_identities where publication_id = $1 and is_active = true`,
      [publicationId],
    );
    expect(adopted).toMatchObject({ kind: "uploaded", file: "campaign.html" });
  });

  test("designs one from the brand when there is no file", async ({ page }) => {
    await login(page);
    await page.goto(`/publications/${publicationId}/blueprint`);
    await expect(async () => {
      await page.getByTestId("blueprint-from-brand").click();
      await expect(page.getByText("What Briefly understood")).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 60_000 });

    await page.getByTestId("blueprint-adopt").click();
    await expect(page.getByText("Designed from your brand.")).toBeVisible({ timeout: 15_000 });
    const adopted = await one<{ kind: string }>(`select identity->'source'->>'kind' as kind from publication_identities where publication_id = $1 and is_active = true`, [publicationId]);
    expect(adopted!.kind).toBe("brand");
  });
});
