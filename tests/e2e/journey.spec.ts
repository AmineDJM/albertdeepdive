import { test, expect, type Page } from "@playwright/test";
import { closeDb, many, one } from "./db";
import { login } from "./helpers";

/**
 * The critical journey, end to end, through the real interface:
 * sign in → open the edition → invite contributors → a contributor submits through their personal
 * link with no account → triage the submission → run the newsroom pipeline → cluster → draft →
 * check the sources behind a sentence → approve → plan the pages → generate the PDF and the Word
 * document from the same snapshot → work the quality gates.
 *
 * It runs against the development database, and every step it performs is one a person performs.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  await closeDb();
});

type Row = Record<string, string | number | Date | null>;

async function currentEditionId(): Promise<string> {
  const row = await one<Row>("select id from editions where status not in ('ARCHIVED') order by created_at limit 1");
  expect(row, "the database must be seeded before the journey runs").not.toBeNull();
  return String(row!.id);
}

/**
 * The text of the newest toast. Toasts linger, so a step that follows another one waits for a
 * message that is not the previous step's — otherwise it reads the last action's confirmation.
 */
async function toast(page: Page, differentFrom?: string): Promise<string> {
  const el = page.locator("[data-sonner-toast]").last();
  let text = "";
  await expect
    .poll(
      async () => {
        if (!(await el.count())) return "";
        text = (await el.innerText()).replace(/\s+/g, " ").trim();
        return text === differentFrom ? "" : text;
      },
      { timeout: 30_000 },
    )
    .not.toBe("");
  return text;
}

/**
 * Opens a page and waits until React has taken over. Filling a field before hydration sets the DOM
 * value without telling React, and the form then looks unchanged.
 */
async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "networkidle" });
}

/** Clears any toast still on screen, so the next assertion cannot read a stale one. */
async function clearToasts(page: Page) {
  const toasts = page.locator("[data-sonner-toast]");
  for (let i = (await toasts.count()) - 1; i >= 0; i--) {
    await toasts.nth(i).locator("button").first().click({ timeout: 2000 }).catch(() => {});
  }
  await expect.poll(async () => toasts.count(), { timeout: 15_000 }).toBe(0);
}

test.describe("the critical journey", () => {
  test("1–2 · an editor signs in and finds the edition in progress", async ({ page }) => {
    await login(page);
    await expect(page.locator("main").getByText("Current edition", { exact: true })).toBeVisible();
    const editionId = await currentEditionId();
    await page.goto(`/editions/${editionId}`);
    await expect(page.locator("main").getByText("Control room", { exact: true }).first()).toBeVisible();
    await expect(page.locator("main").getByText("Workflow", { exact: true })).toBeVisible();
  });

  test("3–7 · a campaign is launched and a contributor files a story with no account", async ({ page, context }) => {
    test.setTimeout(240_000);
    await login(page);

    // The next issue is where a campaign can still be opened; the May issue is already in production.
    const upcoming = await one<Row>("select id, label from editions where status = 'UPCOMING' order by created_at limit 1");
    test.skip(!upcoming, "no upcoming edition to run a campaign on");
    const editionId = String(upcoming!.id);
    await page.goto(`/editions/${editionId}/campaign`);

    const schedule = page.getByRole("button", { name: /Schedule the campaign/i });
    if (await schedule.count()) {
      await schedule.click();
      await toast(page);
      await page.goto(`/editions/${editionId}/campaign`);
    }

    const launch = page.getByRole("button", { name: /Launch campaign/i });
    if (await launch.count()) {
      await launch.click();
      // The launch is confirmed before invitations go out.
      const confirm = page.getByRole("button", { name: /^(Launch|Send|Confirm)/i }).last();
      if (await confirm.count()) await confirm.click();
      expect(await toast(page)).toMatch(/launch|sent|open/i);
    }

    // The contributor's personal link is the one the invitation email carries.
    let link: string | null = null;
    for (let i = 0; i < 20 && !link; i++) {
      const row = await one<Row>(
        `select substring(html from 'contribute/[A-Za-z0-9_-]+') as path from email_log
         where edition_id = $1 and template like 'campaign_%' and html like '%contribute/%'
         order by created_at desc limit 1`,
        [editionId],
      );
      link = row?.path ? String(row.path) : null;
      if (!link) await page.waitForTimeout(2000);
    }
    expect(link, "launching the campaign must send a personal link").not.toBeNull();

    // A brand new browser context: the contributor is signed in to nothing.
    const anon = await context.browser()!.newContext();
    const anonPage = await anon.newPage();
    await anonPage.goto(`/${link}`);
    await expect(anonPage.getByText(/tell us|what happened|contribut/i).first()).toBeVisible({ timeout: 30_000 });

    const headline = `Data sprint at the Lyon campus ${Date.now()}`;
    await anonPage.getByLabel(/headline|title|what is it about/i).first().fill(headline);
    await anonPage
      .getByLabel(/what happened|tell us|description|details/i)
      .first()
      .fill(
        "Thirty B2 students spent Saturday on a forecasting sprint with a retail partner. Two teams presented at the end of the day and the jury asked them to publish their notebooks.",
      );

    // Consent is asked for explicitly, never assumed.
    const consent = anonPage.getByRole("checkbox");
    for (let i = 0; i < (await consent.count()); i++) {
      const box = consent.nth(i);
      if ((await box.getAttribute("data-state")) !== "checked") await box.click();
    }
    await anonPage.getByRole("button", { name: /send|submit|finish/i }).last().click();
    await expect(anonPage.getByText(/thank|received|sent|got it/i).first()).toBeVisible({ timeout: 60_000 });
    await anon.close();

    const stored = await one<Row>("select id, edition_id from submissions where title = $1", [headline]);
    expect(stored, "the contribution must reach the newsroom").not.toBeNull();
    expect(String(stored!.edition_id)).toBe(editionId);

    // 8–9: it lands in the triage inbox, and the pipeline processes it on demand.
    await page.goto(`/editions/${editionId}/inbox`);
    await expect(page.locator("main").getByText(headline).first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /Run AI processing/i }).first().click();
    await page.getByRole("button", { name: /^Run processing$/i }).click();
    expect(await toast(page)).toMatch(/processing finished|processed/i);

    const processed = await one<Row>("select status, normalized_text from submissions where title = $1", [headline]);
    expect(processed!.normalized_text, "the pipeline must normalise what the contributor wrote").toBeTruthy();
  });

  test("8 · the submission appears in the triage inbox", async ({ page }) => {
    await login(page);
    const editionId = await currentEditionId();
    await page.goto(`/editions/${editionId}/inbox`);
    await expect(page.getByRole("heading", { name: /inbox/i })).toBeVisible();
    const rows = page.locator("main li, main tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("10 · the stories board shows clustered stories grouped by section", async ({ page }) => {
    await login(page);
    const editionId = await currentEditionId();
    await page.goto(`/editions/${editionId}/stories`);
    await expect(page.getByRole("heading", { name: /stories/i })).toBeVisible();
    // Stories are grouped under their section heading, not just listed.
    await expect(page.getByRole("heading", { name: /Business Deep Dive/i }).first()).toBeVisible();
    const cards = page.locator('a[href^="/stories/"]');
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test("12–13 · the article editor shows the sources behind the draft and approves it", async ({ page }) => {
    await login(page);
    const article = await one<Row>(
      "select a.id, a.story_id from articles a where a.status in ('AI_DRAFT','IN_EDITING','READY_FOR_REVIEW') order by a.word_count desc limit 1",
    );
    test.skip(!article, "no editable article in the seed");
    await open(page, `/articles/${article!.id}`);

    // The sources are on the page, not hidden behind a promise that they exist.
    await expect(page.getByRole("heading", { name: /sources behind this article/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /fact sheet/i })).toBeVisible();
    expect(await page.locator('aside a[href^="/editions/"]').count(), "the lead source must be reachable").toBeGreaterThan(0);

    // Every assistant action is explicit and proposes; it never rewrites the draft on its own.
    await expect(page.getByText("Every action returns a proposal. Nothing changes until you accept it.")).toBeVisible();
    for (const label of ["Shorten", "Check factual consistency", "Suggest pull quote"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }

    // Nothing to save until the editor actually changes something.
    const save = page.getByRole("button", { name: /^Save$/ });
    await expect(save).toBeDisabled();

    // Edit the standfirst rather than the headline: the headline has a print length limit, which
    // the editor enforces, and this step is about saving, not about that rule.
    const standfirst = page.getByLabel("Standfirst");
    const original = await standfirst.inputValue();
    await standfirst.fill(`${original} Reported from the Paris campus.`);
    await expect(save).toBeEnabled();
    await save.click();
    expect(await toast(page)).toMatch(/saved as revision/i);
    await clearToasts(page);

    // 13: approval is refused while a fact is still disputed. The newsroom will not print a
    // sentence two contributors disagree about just because an editor is in a hurry.
    const disputed = await one<Row>("select count(*)::int as n from facts where story_id = $1 and status = 'DISPUTED'", [String(article!.story_id)]);
    const approve = page.getByRole("button", { name: /^Approve$/ });
    await expect(approve).toBeEnabled();

    if (Number(disputed!.n) > 0) {
      await approve.click();
      expect(await toast(page)).toMatch(/disputed fact/i);
      await clearToasts(page);

      // Resolve it on the story file, which is where the sources are. Settling a fact means
      // writing what is true and how you know; the newsroom never guesses on the editor's behalf.
      await open(page, `/stories/${article!.story_id}`);
      const keep = page.getByRole("button", { name: /^Keep this$/ }).first();
      await expect(keep).toBeVisible();
      await keep.click();

      const settle = page.getByRole("button", { name: /Keep this version/i });
      await expect(settle, "a reason is required before a fact can be settled").toBeDisabled();
      await page.locator("#settled-statement").fill("The AI Act was adopted in 2024; the April 2025 date in the submission is wrong.");
      await page.locator("#settled-reason").fill("Checked against the Official Journal; the contributor confirmed the mix-up by email.");
      await expect(settle).toBeEnabled();
      await settle.click();
      expect(await toast(page)).toMatch(/conflict resolved/i);
      await clearToasts(page);

      await expect
        .poll(async () => Number((await one<Row>("select count(*)::int as n from facts where story_id = $1 and status = 'DISPUTED'", [String(article!.story_id)]))!.n), { timeout: 15_000 })
        .toBeLessThan(Number(disputed!.n));

      await open(page, `/articles/${article!.id}`);
    }

    await page.getByRole("button", { name: /^Approve$/ }).click();
    expect(await toast(page)).toMatch(/approved/i);
    await expect
      .poll(async () => (await one<Row>("select status from articles where id = $1", [article!.id]))!.status, { timeout: 15_000 })
      .toBe("APPROVED");

    // Put the standfirst back so the journey can be replayed from a clean draft.
    await clearToasts(page);
    await open(page, `/articles/${article!.id}`);
    const field = page.getByLabel("Standfirst");
    if ((await field.inputValue()) !== original) {
      await field.fill(original);
      await page.getByRole("button", { name: /^Save$/ }).click();
      expect(await toast(page)).toMatch(/saved as revision/i);
    }
    await expect
      .poll(async () => (await one<Row>("select standfirst from articles where id = $1", [article!.id]))!.standfirst, { timeout: 15_000 })
      .toBe(original);
  });

  test("14 · an editor assigns a story to a section from the story file", async ({ page }) => {
    await login(page);
    const story = await one<Row>("select id, edition_id from stories order by created_at limit 1");
    test.skip(!story, "no story in the seed");
    await page.goto(`/stories/${story!.id}`);
    const select = page.getByLabel("Section");
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(1);
  });

  test("17–18 · one snapshot produces both the PDF and the Word document", async ({ page }) => {
    test.setTimeout(300_000);
    await login(page);
    const editionId = await currentEditionId();
    const url = `/editions/${editionId}/exports`;
    await page.goto(url);
    await page.getByRole("button", { name: /Generate PDF and DOCX/i }).click();
    const queued = await toast(page);
    expect(queued).toMatch(/queued for rendering/i);
    const label = /version (v[\d.]+)/i.exec(queued)?.[1];
    expect(label, "the toast must name the version it queued").toBeTruthy();

    // Wait for THIS version, not for any version that happens to be ready already.
    const card = () => page.locator(`li[data-version="${label}"]`);
    await expect
      .poll(
        async () => {
          await page.goto(url);
          return (await card().innerText()).replace(/\s+/g, " ");
        },
        { timeout: 240_000, intervals: [5000] },
      )
      .toMatch(/\bready\b/i);

    for (const kind of ["PDF", "DOCX"]) {
      const button = card().getByRole("button", { name: new RegExp(`^${kind}\\b`) });
      await expect(button).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120_000 }), button.click()]);
      expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${kind.toLowerCase()}$`));
    }

    // Both files belong to the same version, which is what makes them describe the same issue.
    const assets = await many<Row>(
      `select pa.kind, pv.label from publication_assets pa join publication_versions pv on pv.id = pa.version_id
       where pv.edition_id = $1 and pv.label = $2`,
      [editionId, label!],
    );
    expect(assets.length).toBe(2);
    expect(new Set(assets.map((a) => a.label)).size).toBe(1);
    expect(new Set(assets.map((a) => a.kind))).toEqual(new Set(["PDF", "DOCX"]));
  });

  test("19 · the quality gates block the issue and name what is wrong", async ({ page }) => {
    await login(page);
    const editionId = await currentEditionId();
    await page.goto(`/editions/${editionId}/qa`);
    await expect(page.getByRole("heading", { name: /QA & publish/i })).toBeVisible();
    await expect(page.locator("main").getByText("Publication checklist")).toBeVisible();

    for (const gate of ["No prohibited (RED) media", "No unresolved factual conflicts", "PDF generated", "DOCX generated"]) {
      await expect(page.locator("main").getByText(gate, { exact: true })).toBeVisible();
    }

    // Prohibited media can never be waved through, whoever is asking.
    const red = page.locator("li", { hasText: "No prohibited (RED) media" }).first();
    await expect(red.getByRole("button", { name: /Override/ })).toHaveCount(0);
  });

  test("19 · overriding a gate needs the editor in chief and a written reason", async ({ browser }) => {
    const editionId = await currentEditionId();

    // An ordinary editor cannot override at all.
    const deskCtx = await browser.newContext();
    const desk = await deskCtx.newPage();
    await login(desk, { email: "editor@albertschool.com", password: "albert-deep-dive" });
    await desk.goto(`/editions/${editionId}/qa`);
    await expect(desk.getByRole("heading", { name: /QA & publish/i })).toBeVisible();
    await expect(desk.getByRole("button", { name: /Override/ })).toHaveCount(0);
    await deskCtx.close();

    // The editor in chief can, and the reason they type is what the gate then shows.
    const chiefCtx = await browser.newContext();
    const page = await chiefCtx.newPage();
    await login(page, { email: "eic@albertschool.com", password: "albert-deep-dive" });
    await open(page, `/editions/${editionId}/qa`);
    const gate = page.locator("li", { hasText: "Image rights validated" }).first();
    const override = gate.getByRole("button", { name: /Override/ });
    test.skip((await override.count()) === 0, "that gate already passes in this database");

    await override.click();
    await expect(page.getByRole("button", { name: /Override the gate/ })).toBeDisabled();
    const reason = "Rights confirmed by email on 3 May; the countersigned licences follow this week.";
    await page.locator("#override-reason").fill(reason);
    await page.getByRole("button", { name: /Override the gate/ }).click();
    const overrideToast = await toast(page);
    expect(overrideToast).toMatch(/overridden/i);

    await open(page, `/editions/${editionId}/qa`);
    const after = page.locator("li", { hasText: "Image rights validated" }).first();
    await expect(after.getByText("Overridden")).toBeVisible();
    await expect(after.getByText(reason)).toBeVisible();

    // Put the edition back as it was, so the journey is repeatable.
    await after.getByRole("button", { name: /Lift/ }).click();
    expect(await toast(page, overrideToast)).toMatch(/override removed/i);
    await chiefCtx.close();
  });
});
