import { test, expect } from "@playwright/test";
import { closeDb, one } from "./db";
import { login, setExperience } from "./helpers";

/**
 * Revising an issue that is already made.
 *
 * Two promises are checked here, and they are the ones a customer would notice breaking. Nothing
 * happens to the issue while you talk — the conversation fills a list and the list is what costs a
 * revision — and when there is no model connected, the assistant says so rather than guessing at
 * the words and acting on the guess.
 */
test.describe("revise", () => {
  test.afterAll(async () => {
    await closeDb();
  });

  test("the issue sits beside the conversation, and nothing is waiting yet", async ({ page }) => {
    await setExperience("advanced");
    await login(page);
    const edition = await one<{ id: string }>(`select id from editions order by created_at limit 1`);
    await page.goto(`/editions/${edition!.id}/revise`);

    await expect(page.getByRole("heading", { level: 1, name: /Revise/i })).toBeVisible();
    // The plan's allowance is stated up front, in the header, not discovered on pressing.
    await expect(page.locator("main")).toContainText(/revisions/i);

    // The proof is the issue itself, at the same address the printer's copy comes from.
    const proof = page.locator(`iframe[src="/print/edition/${edition!.id}"]`);
    await expect(proof).toBeVisible();

    await expect(page.getByText("Waiting to be applied")).toBeVisible();
    await expect(page.getByText(/Nothing yet/)).toBeVisible();
  });

  test("with no model connected it says so, and stages nothing", async ({ page }) => {
    await setExperience("advanced");
    await login(page);
    const edition = await one<{ id: string }>(`select id from editions order by created_at limit 1`);
    await page.goto(`/editions/${edition!.id}/revise`);

    await page.getByPlaceholder("What should change?").fill("elle est beaucoup trop dense, ça donne pas envie de lire");
    await page.getByRole("button", { name: "Send" }).click();

    // What it measured is true and useful; what it cannot do, it names.
    await expect(page.getByText(/pages/).first()).toBeVisible();
    await expect(page.getByText(/no language model is connected/i)).toBeVisible();

    // And the list is still empty: a guess never became a change waiting to be bought.
    await expect(page.getByText(/Nothing yet/)).toBeVisible();
    const staged = await one<{ n: string }>(
      `select coalesce(sum(jsonb_array_length(changes)), 0)::text as n from edition_revisions where edition_id = $1 and status = 'DRAFT'`,
      [edition!.id],
    );
    expect(Number(staged!.n)).toBe(0);
  });
});
