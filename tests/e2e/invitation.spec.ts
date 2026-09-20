import { test, expect } from "@playwright/test";
import { closeDb, one } from "./db";
import { login, setExperience } from "./helpers";

/**
 * Nobody hears from Briefly by accident.
 *
 * The invitation is the one thing in an edition that cannot be taken back, and it used to leave on
 * a single click with nothing shown beforehand but a number. Here it is read first — the real
 * email, the real subject, the real names — and then either sent, which takes a second press
 * against the number of people it would reach, or given a date, which can be moved or dropped for
 * as long as nothing has gone.
 */
test.describe("the invitation", () => {
  let editionId: string;
  let before: { status: string; opens_at: string; deadline_at: string; grace_ends_at: string } | null = null;

  test.beforeAll(async () => {
    const row = await one<{ id: string; campaign_id: string }>(
      `select e.id, c.id as campaign_id from editions e join submission_campaigns c on c.edition_id = e.id where c.status in ('DRAFT','SCHEDULED') order by e.created_at desc limit 1`,
    );
    expect(row, "an edition whose invitation has not gone out").toBeTruthy();
    editionId = row!.id;
    before = await one(`select status, opens_at, deadline_at, grace_ends_at from submission_campaigns where id = $1`, [row!.campaign_id]);
    // A last day far enough away that a date can be chosen before it, whatever month the seed made.
    await one(
      `update submission_campaigns set status = 'DRAFT', closed_at = null, opens_at = now() - interval '1 day', deadline_at = now() + interval '20 days', grace_ends_at = now() + interval '21 days' where id = $1`,
      [row!.campaign_id],
    );
  });

  test.afterAll(async () => {
    if (before) {
      await one(`update submission_campaigns set status = $1, opens_at = $2, deadline_at = $3, grace_ends_at = $4 where edition_id = $5`, [
        before.status,
        before.opens_at,
        before.deadline_at,
        before.grace_ends_at,
        editionId,
      ]);
    }
    await closeDb();
  });

  test("is read, then sent on a second press — or given a date that can be taken back", async ({ page }) => {
    await setExperience("standard");
    await login(page);
    await page.goto(`/editions/${editionId}/deadline`);
    await expect(page.getByRole("heading", { level: 1, name: "When for?" })).toBeVisible();
    await expect(page.locator("main").getByText("The invitation", { exact: true })).toBeVisible();

    // The email itself, built by the code that sends it.
    await expect(async () => {
      await page.getByTestId("send-invitations").click();
      await expect(page.getByTestId("invitation-preview")).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "This is what they will get" })).toBeVisible();
    await expect(page.getByTestId("invitation-recipients")).toBeVisible();

    // Sending asks a second time, and "Not yet" means nothing happened.
    await page.getByTestId("send-invitations-now").click();
    await expect(page.getByTestId("confirm-send-invitations")).toBeVisible();
    await page.getByRole("button", { name: "Not yet" }).click();
    await expect(page.getByTestId("invitation-preview")).toBeVisible();
    expect((await one<{ status: string }>(`select status from submission_campaigns where edition_id = $1`, [editionId]))!.status).toBe("DRAFT");

    // A date instead. The field speaks the newsroom's clock; five days from now is well inside it.
    const when = new Date(Date.now() + 5 * 86_400_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await page.getByTestId("schedule-invitations").click();
    await page.getByTestId("invitation-schedule-at").fill(`${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T09:00`);
    await page.getByTestId("confirm-schedule-invitations").click();
    await expect(page.getByTestId("invitation-preview")).toHaveCount(0);
    await expect(page.getByTestId("send-invitations")).toContainText("Going out");
    expect((await one<{ status: string }>(`select status from submission_campaigns where edition_id = $1`, [editionId]))!.status).toBe("SCHEDULED");

    // And taken back out while it is still unsent.
    await expect(async () => {
      await page.getByTestId("send-invitations").click();
      await expect(page.getByTestId("cancel-schedule-invitations")).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByTestId("cancel-schedule-invitations").click();
    await expect(page.getByTestId("send-invitations")).toContainText("Read the invitation");
    expect((await one<{ status: string }>(`select status from submission_campaigns where edition_id = $1`, [editionId]))!.status).toBe("DRAFT");
  });
});
