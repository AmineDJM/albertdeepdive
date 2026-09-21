import { test, expect } from "@playwright/test";
import { closeDb, one } from "./db";
import { ADMIN, login, setExperience } from "./helpers";

/**
 * Unmaking what you made.
 *
 * Every other spec in this suite builds something. This one takes something apart, which until now
 * nobody could do from Standard at all: an edition could only be removed by ticking it in a list
 * Standard does not show, and a newsletter could not be removed from the interface at any price.
 *
 * It works on a title of its own making rather than on the seed — created through the dialog, with
 * the first edition Briefly opens along with it — so that a failure halfway through cannot take
 * the newsroom the other specs depend on with it.
 */
test.describe("taking it back", () => {
  const NAME = `Une lettre à défaire ${Date.now()}`;
  let publicationId: string;
  let editionId: string;

  test.afterAll(async () => {
    // Whatever the test got through, the title it invented does not outlive it.
    if (publicationId) await one(`delete from publications where id = $1`, [publicationId]);
    await closeDb();
  });

  test("a newsletter made by mistake, and the edition that came with it", async ({ page }) => {
    await setExperience("standard");
    await login(page);

    // 1 — make one. A new title lands in its own first edition, so both ids come from that URL.
    await page.goto("/publications");
    await page.getByRole("button", { name: /new title/i }).click();
    const form = page.getByRole("dialog");
    await form.getByLabel("Name").fill(NAME);
    await form.getByRole("button", { name: /create title/i }).click();
    await page.waitForURL(/\/editions\/[0-9a-f-]{36}/);
    editionId = page.url().split("/editions/")[1].split(/[?#]/)[0];

    const row = await one<{ publication_id: string }>(`select publication_id from editions where id = $1`, [editionId]);
    expect(row?.publication_id, "the new edition belongs to the new title").toBeTruthy();
    publicationId = row!.publication_id;

    // 2 — the edition goes from the edition itself, which is where somebody decides it should not exist.
    await page.getByTestId("delete-edition").click();
    await expect(page.getByRole("alertdialog")).toContainText(/cannot be undone/i);
    await page.getByTestId("confirm-delete-edition").click();
    await page.waitForURL(/\/overview/);
    await expect
      .poll(async () => (await one(`select id from editions where id = $1`, [editionId])) === null, { message: "the edition is gone" })
      .toBe(true);

    // 3 — the title goes from its own page. With nothing published under it there is one answer.
    await page.goto(`/publications/${publicationId}`);
    await page.getByTestId("delete-publication").click();
    await expect(page.getByRole("alertdialog")).toContainText(/cannot be undone/i);
    await page.getByTestId("confirm-delete-publication").click();
    await page.waitForURL(/\/overview/);
    await expect
      .poll(async () => (await one(`select id from publications where id = $1`, [publicationId])) === null, { message: "the title is gone" })
      .toBe(true);
  });

  test("a newsletter with issues behind it offers the archive before the deletion", async ({ page }) => {
    // The seed's own title, which really has editions: opened, read, and closed without touching it.
    //
    // Scoped to the workspace the test signs into, and ordered by id after the count. Neither is
    // decoration: the seed gives four workspaces a title apiece, two of them with two editions, so
    // an unscoped `order by count desc limit 1` picks whichever the planner returns first — and
    // when that was another workspace's title the page rightly answered 404, because it is not
    // this admin's to see. The control never rendered and the test hung on a locator, blaming the
    // button for tenant isolation doing its job.
    const title = await one<{ id: string; name: string; count: string }>(
      `select p.id, p.name, count(e.id)::text as count
         from publications p
         join editions e on e.publication_id = p.id
         join organization_members m on m.organization_id = p.organization_id
         join users u on u.id = m.user_id
        where u.email = $1
        group by p.id
       having count(e.id) > 0
        order by count(e.id) desc, p.id
        limit 1`,
      [ADMIN.email],
    );
    expect(title, "a seeded title with editions").toBeTruthy();

    await setExperience("standard");
    await login(page);
    await page.goto(`/publications/${title!.id}`);
    await page.getByTestId("delete-publication").click();

    const dialog = page.getByRole("alertdialog");
    // It names the number in the way rather than refusing without saying why.
    await expect(dialog).toContainText(new RegExp(`${title!.count}\\s+editions?`, "i"));
    // And the softer answer is on the screen, named, beside the one that deletes.
    await expect(page.getByTestId("archive-publication")).toBeVisible();
    await expect(page.getByTestId("confirm-delete-publication")).toContainText(/editions/i);

    await page.getByRole("button", { name: /keep it/i }).click();
    await expect(dialog).toBeHidden();
    // Reading the warning changed nothing.
    expect(await one(`select id from publications where id = $1`, [title!.id])).toBeTruthy();
  });
});
