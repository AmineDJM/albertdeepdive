import { test, expect } from "@playwright/test";
import { closeDb, many, one } from "./db";
import { ADMIN, login, setExperience } from "./helpers";

/**
 * What a newsletter will look like, before there is one to look at.
 *
 * Two halves of the same screen. An edition with nothing written in it must not offer a preview or
 * a file — those used to hand back a cover over an empty issue, which reads as the product's best
 * effort rather than as "not yet" — and in their place it must offer the models, which is the
 * question somebody at that point in the month actually has.
 */
test.describe("the models", () => {
  let publicationId: string;
  let emptyId: string;
  let fullId: string;

  test.beforeAll(async () => {
    const title = await one<{ id: string }>(
      `select p.id from publications p
         join organization_members m on m.organization_id = p.organization_id
         join users u on u.id = m.user_id
        where u.email = $1
        order by p.created_at
        limit 1`,
      [ADMIN.email],
    );
    expect(title, "a title in the signed-in admin's workspace").toBeTruthy();
    publicationId = title!.id;

    // An issue with words in it, and one without. Both are the seed's; neither is modified.
    const rows = await many<{ id: string; written: string }>(
      `select e.id,
              (select count(*) from articles a
                 join stories s on s.id = a.story_id
                where a.edition_id = e.id
                  and a.status <> 'EMPTY'
                  and s.status in ('SELECTED','DRAFTING','IN_REVIEW','APPROVED','PUBLISHED'))::text as written
         from editions e
        where e.publication_id = $1 and e.hidden_at is null`,
      [publicationId],
    );
    fullId = rows.find((row) => Number(row.written) > 0)?.id ?? "";
    emptyId = rows.find((row) => Number(row.written) === 0)?.id ?? "";
  });

  test.afterAll(async () => {
    await closeDb();
  });

  test("an edition with nothing in it offers the models, not an empty file", async ({ page }) => {
    test.skip(!emptyId, "the seed has no edition without a written article");
    await setExperience("standard");
    await login(page);
    await page.goto(`/editions/${emptyId}`);

    await expect(page.getByTestId("nothing-to-preview")).toBeVisible();
    // The three that would have produced a document with no newsletter in it.
    for (const name of [/^preview$/i, /^pdf$/i, /^word$/i]) {
      await expect(page.getByRole("link", { name })).toHaveCount(0);
    }

    // And the route says the same thing, because that URL gets bookmarked and passed around.
    const preview = await page.goto(`/print/edition/${emptyId}`);
    expect(preview?.status()).toBe(200);
    await expect(page.locator("body")).toContainText(/nothing to preview|rien à prévisualiser/i);
  });

  test("an edition that has been written keeps its preview and its files", async ({ page }) => {
    test.skip(!fullId, "the seed has no edition with a written article");
    await setExperience("standard");
    await login(page);
    await page.goto(`/editions/${fullId}`);

    await expect(page.getByTestId("nothing-to-preview")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^preview$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^pdf$/i })).toBeVisible();
  });

  test("the shelf shows every model as a page, and says which one is in use", async ({ page }) => {
    const editionId = emptyId || fullId;
    test.skip(!editionId, "the seed has no edition under this title");
    await setExperience("standard");
    await login(page);
    await page.goto(`/editions/${editionId}/models`);

    await expect(page.getByTestId("model-gallery")).toBeVisible();
    // The workspace's own first, then Briefly's six.
    for (const id of ["brand", "editorial", "modern", "minimal", "classic", "bold", "playful"]) {
      await expect(page.getByTestId(`model-card-${id}`), id).toBeVisible();
    }
    // Every card admits its words are samples, on the card rather than once at the top.
    const samples = page.getByText(/sample words|texte d'exemple/i);
    expect(await samples.count()).toBe(7);
  });

  test("choosing one changes what the title is made on", async ({ page }) => {
    const editionId = emptyId || fullId;
    test.skip(!editionId, "the seed has no edition under this title");
    // A title whose model has never been set has no row at all: `activeIdentity` composes a
    // default in memory rather than writing one. So this is a version to compare against, not a
    // row that must exist.
    const before = await one<{ version: number }>(
      `select version from publication_identities where publication_id = $1 and is_active order by version desc limit 1`,
      [publicationId],
    );

    await setExperience("standard");
    await login(page);
    await page.goto(`/editions/${editionId}/models`);
    await page.getByTestId("adopt-model-classic").click();

    // A new version of the identity, recording Briefly as where the design came from.
    await expect
      .poll(
        async () => {
          // The identity is one jsonb document, so the origin is read out of it rather than
          // from a column of its own.
          const row = await one<{ kind: string | null }>(
            `select identity->'source'->>'kind' as kind
               from publication_identities
              where publication_id = $1 and is_active
              order by version desc limit 1`,
            [publicationId],
          );
          return row?.kind ?? null;
        },
        { message: "the title is made on one of Briefly's models" },
      )
      .toBe("briefly");

    // Adopting versions the identity rather than overwriting it, so the design a published
    // edition was composed under stays readable.
    const after = await one<{ version: number }>(
      `select version from publication_identities where publication_id = $1 and is_active order by version desc limit 1`,
      [publicationId],
    );
    expect(after!.version).toBeGreaterThan(before?.version ?? 0);

    // And the shelf says so when it is reopened.
    await page.reload();
    await expect(page.getByTestId("model-card-classic")).toContainText(/in use|utilisé/i);
  });
});
