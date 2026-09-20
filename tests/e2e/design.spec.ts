import { test, expect, type Page } from "@playwright/test";
import { closeDb, one } from "./db";
import { login, setExperience } from "./helpers";

/**
 * The design room, end to end.
 *
 * §28 of the design brief asks for controls an editor can actually reach, and §24 for "no dead UI"
 * — so what is checked here is that every control on the screen runs the real engine: designing
 * composes a publication, the preview beside it is the renderer the reader will get rather than a
 * picture of one, a piece offers the ways it could be drawn *with the material it has*, the pages
 * lay out and report what spills, and with no model connected the control that needs judgement says
 * so instead of guessing.
 */
test.describe.configure({ mode: "serial" });

/**
 * A click, and the proof it landed.
 *
 * The room is a server component with a client workbench inside it, and in development the markup
 * arrives well before React has hydrated — so a click that lands first does nothing at all, silently.
 * Retrying until the screen reacts is the difference between testing the engine and testing how
 * fast this machine compiles.
 */
async function press(page: Page, button: string | RegExp, landed: () => Promise<unknown>) {
  await expect(async () => {
    await page.getByRole("button", { name: button }).first().click();
    await landed();
  }).toPass({ timeout: 120_000, intervals: [2_000, 3_000, 5_000] });
}

test.describe("the design room", () => {
  test.afterAll(async () => {
    await closeDb();
  });

  /** The seeded issue: the one with the most articles in it, so there is a publication to design. */
  async function editionWithContent(): Promise<string> {
    const row = await one<{ id: string }>(
      `select e.id from editions e join articles a on a.edition_id = e.id where e.hidden_at is null group by e.id order by count(a.id) desc limit 1`,
    );
    expect(row, "an edition with articles must exist before the design tests run").not.toBeNull();
    return String(row!.id);
  }

  /** The room, with this issue designed — the state every test after the first one starts from. */
  async function designed(page: Page): Promise<string> {
    await setExperience("advanced");
    await login(page);
    const editionId = await editionWithContent();
    await page.goto(`/editions/${editionId}/design`);
    await expect(page.getByRole("heading", { level: 1, name: "Design" })).toBeVisible();
    if (await page.getByText("Nothing has been designed yet.").isVisible()) {
      await press(page, /Design (this issue|it again)/, () => expect(page.getByText("Nothing has been designed yet.")).toBeHidden({ timeout: 10_000 }));
    }
    return editionId;
  }

  test("designs the issue, and shows the design rather than a picture of one", async ({ page }) => {
    test.setTimeout(240_000);
    await setExperience("advanced");
    await login(page);
    const editionId = await editionWithContent();
    await page.goto(`/editions/${editionId}/design`);

    await expect(page.getByRole("heading", { level: 1, name: "Design" })).toBeVisible();
    await expect(page.getByText("How this issue should feel")).toBeVisible();

    // Design it — or design it again, if this issue was designed before.
    await press(page, /Design (this issue|it again)/, () => expect(page.getByText("Nothing has been designed yet.")).toBeHidden({ timeout: 10_000 }));

    // The pieces are the design's own blocks, named as an editor would name them.
    await expect(page.getByRole("button", { name: "Design it again" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Lay out the pages" })).toBeEnabled();

    // The preview is the live renderer at the same address the iframe uses.
    await expect(page.locator(`iframe[src="/design/edition/${editionId}?medium=web"]`)).toBeVisible();
    const web = await page.request.get(`/design/edition/${editionId}?medium=web`);
    expect(web.status()).toBe(200);
    const html = await web.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('<main id="edition"');

    // And the design is in the database, not only on the screen.
    const saved = await one<{ n: string }>(`select count(*)::text as n from edition_designs where edition_id = $1`, [editionId]);
    expect(Number(saved!.n)).toBeGreaterThan(0);
  });

  test("shows the same issue as email, on email's own terms", async ({ page }) => {
    test.setTimeout(240_000);
    const editionId = await designed(page);

    await press(page, "Email", () => expect(page.locator(`iframe[src="/design/edition/${editionId}?medium=email"]`)).toBeVisible({ timeout: 10_000 }));

    const email = await page.request.get(`/design/edition/${editionId}?medium=email`);
    expect(email.status()).toBe(200);
    const html = await email.text();
    // Email is tables and inline styles, whatever the web edition does.
    expect(html).toContain("<table");
    expect(html.toLowerCase()).toContain("unsubscribe");
    expect(html).not.toContain('<main id="edition"');
  });

  test("offers a piece the ways it could be drawn, and holds it when asked", async ({ page }) => {
    test.setTimeout(240_000);
    await designed(page);

    // The first piece in the list: the masthead or the cover, depending on the issue.
    const piece = page.getByRole("tabpanel", { name: "Pieces" }).locator("button").first();
    await expect(async () => {
      await piece.click();
      await expect(page.getByText(/Draw it another way|There is no other way this piece can be drawn/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    const hold = page.getByRole("button", { name: /Hold it as it is|Release it/ });
    const wasHeld = ((await hold.textContent()) ?? "").includes("Release");
    await press(page, /Hold it as it is|Release it/, () =>
      expect(page.getByRole("button", { name: wasHeld ? "Hold it as it is" : "Release it" })).toBeVisible({ timeout: 15_000 }),
    );
  });

  test("lays the pages out and says what spills", async ({ page }) => {
    test.setTimeout(300_000);
    await designed(page);

    // A real pagination pass through a real browser: how many pages, and what is wrong with them.
    await press(page, "Lay out the pages", () => expect(page.getByText(/nothing spills|pages still spill/)).toBeVisible({ timeout: 180_000 }));
  });

  test("with no model connected, says what it cannot read rather than guessing", async ({ page }) => {
    test.setTimeout(240_000);
    const editionId = await designed(page);
    const before = await one<{ n: string }>(`select count(*)::text as n from edition_designs where edition_id = $1`, [editionId]);

    await expect(async () => {
      await page.getByRole("tab", { name: "Ask" }).click();
      await expect(page.getByPlaceholder("Ask for a change in your own words")).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    await page.getByPlaceholder("Ask for a change in your own words").fill("les photos sont trop petites, ça manque de souffle");
    await press(page, "Send", () => expect(page.getByText(/no language model is connected/i)).toBeVisible({ timeout: 60_000 }));

    // It knows what it is looking at even so, and it changed nothing on a guess.
    await expect(page.getByText(/This design has \d+ blocks/)).toBeVisible();
    const after = await one<{ n: string }>(`select count(*)::text as n from edition_designs where edition_id = $1`, [editionId]);
    expect(after!.n).toBe(before!.n);
  });
});
