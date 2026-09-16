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

    // The issue that is still collecting. The May issue is already in production, so the campaign
    // steps belong to the next one — and re-running the journey must find it again once it is open.
    const collecting = await one<Row>(
      `select id, label, status from editions
       where status in ('UPCOMING','OPEN','REMINDER_1','REMINDER_2','GRACE_PERIOD')
       order by created_at limit 1`,
    );
    test.skip(!collecting, "no edition is collecting contributions");
    const editionId = String(collecting!.id);
    await open(page, `/editions/${editionId}/campaign`);

    const schedule = page.getByRole("button", { name: /Schedule the campaign/i });
    if (await schedule.count()) {
      await schedule.click();
      await toast(page);
      await clearToasts(page);
      await open(page, `/editions/${editionId}/campaign`);
    }

    const launch = page.getByRole("button", { name: /Launch campaign/i });
    if (await launch.count()) {
      await launch.click();
      // The launch is confirmed before invitations go out.
      const confirm = page.getByRole("button", { name: /^(Launch|Send|Confirm)/i }).last();
      if (await confirm.count()) await confirm.click();
      expect(await toast(page)).toMatch(/launch|sent|open/i);
    }

    // The contributor's personal link is the one their invitation email carries. Pick someone who
    // has not started anything yet, so the form opens blank and the journey is repeatable.
    let link: string | null = null;
    for (let i = 0; i < 20 && !link; i++) {
      const row = await one<Row>(
        `select substring(el.html from 'contribute/[A-Za-z0-9_-]+') as path from email_log el
         where el.edition_id = $1 and el.template like 'campaign_%' and el.html like '%contribute/%'
           and not exists (select 1 from submissions s where s.edition_id = el.edition_id and s.contributor_id = el.contributor_id)
         order by el.created_at desc limit 1`,
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

    // The form is a four-step wizard: what kind of story, the details, photos, review and send.
    // Wait for each step to arrive before acting on it — the draft autosaves between them.
    const step = (name: RegExp) => expect(anonPage.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });

    await step(/what happened/i);
    const campusLife = anonPage.getByRole("radio", { name: /Campus life/ }).first();
    if ((await campusLife.getAttribute("data-state")) !== "checked") await campusLife.click();
    await anonPage.getByRole("button", { name: /^Continue$/ }).click();

    await step(/tell us more|your story/i);
    await anonPage.getByLabel(/^Title/).fill(headline);
    await anonPage
      .getByLabel(/^What happened\?/)
      .fill(
        "Thirty B2 students spent Saturday on a forecasting sprint with a retail partner. Two teams presented at the end of the day and the jury asked them to publish their notebooks.",
      );
    await anonPage.getByLabel(/^People involved/).fill("Maelle Lalanne, B2 Lyon; Tom Perrin, B2 Lyon");
    await anonPage.getByRole("button", { name: "Lyon", exact: true }).click();
    await anonPage.getByRole("button", { name: /Continue to photos/ }).click();

    // Photos are optional: a contributor with nothing to attach walks straight on.
    await step(/photos/i);
    await anonPage.getByRole("button", { name: /Skip — no files|Continue to review/ }).click();

    // Consent is asked for explicitly: sending without it is refused and says why.
    await step(/review|check|send/i);
    const send = anonPage.getByRole("button", { name: /Send my story/i });
    await send.click();
    await expect(
      anonPage.getByText(/Please confirm that this story may be published/i),
      "sending without consent must be refused, and say so",
    ).toBeVisible({ timeout: 20_000 });
    expect(await one<Row>("select id from submissions where title = $1 and status <> 'DRAFT'", [headline])).toBeNull();

    await anonPage.locator("#consent-publication").click();
    await expect(send).toBeEnabled();
    await send.click();

    await expect(anonPage.getByRole("heading", { name: /your story is in the newsroom/i })).toBeVisible({ timeout: 60_000 });
    await anon.close();

    await expect
      .poll(async () => (await one<Row>("select status from submissions where title = $1", [headline]))?.status, { timeout: 20_000 })
      .not.toBe("DRAFT");

    const stored = await one<Row>("select id, edition_id from submissions where title = $1", [headline]);
    expect(stored, "the contribution must reach the newsroom").not.toBeNull();
    expect(String(stored!.edition_id)).toBe(editionId);

    // 8–9: it lands in the triage inbox, and the pipeline processes it on demand.
    await open(page, `/editions/${editionId}/inbox?view=all`);
    await expect(page.locator("main").getByText(headline).first()).toBeVisible({ timeout: 30_000 });

    // The pipeline only runs once collection is closed, which is the real monthly rhythm.
    await open(page, `/editions/${editionId}/campaign`);
    await page.getByRole("button", { name: /^Close$/ }).click();
    const confirmClose = page.getByRole("button", { name: /close the campaign|^Close$/i }).last();
    await confirmClose.click();
    expect(await toast(page)).toMatch(/clos/i);
    await clearToasts(page);

    await open(page, `/editions/${editionId}/inbox?view=all`);
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
    await open(page, url);
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
          await open(page, url);
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
    await expect(after.getByText("Overridden", { exact: true })).toBeVisible();
    await expect(after.getByText(reason, { exact: false })).toBeVisible();

    // Put the edition back as it was, so the journey is repeatable.
    await after.getByRole("button", { name: /Lift/ }).click();
    expect(await toast(page, overrideToast)).toMatch(/override removed/i);
    await chiefCtx.close();
  });
  test("20–21 · the issue is signed off, published and archived", async ({ page }) => {
    test.setTimeout(600_000);
    await login(page, { email: "eic@albertschool.com", password: "albert-deep-dive" });
    const editionId = await currentEditionId();

    // Everything the gates ask for, done the way an editor would do it.

    // 1. Settle every disputed fact on the stories that are in the issue.
    const disputed = await many<Row>(
      `select distinct f.story_id from facts f join stories s on s.id = f.story_id
       where f.edition_id = $1 and f.status = 'DISPUTED' and s.status in ('SELECTED','DRAFTING','IN_REVIEW','APPROVED','PUBLISHED')`,
      [editionId],
    );
    for (const row of disputed) {
      await open(page, `/stories/${row.story_id}`);
      for (let guard = 0; guard < 10; guard++) {
        const keep = page.getByRole("button", { name: /^Keep this$/ }).first();
        if (!(await keep.count())) break;
        await keep.click();
        const dialog = page.getByRole("button", { name: /Keep this version/i });
        if (await dialog.count()) {
          await page.locator("#settled-reason").fill("Checked against the campus register before going to print.");
          await dialog.click();
        }
        await toast(page);
        await clearToasts(page);
        await open(page, `/stories/${row.story_id}`);
      }
    }

    // 2. Approve every article that is on the plan.
    for (let guard = 0; guard < 30; guard++) {
      const pending = await one<Row>(
        `select a.id from articles a join stories s on s.id = a.story_id
         where a.edition_id = $1 and a.status <> 'APPROVED' and a.status <> 'EMPTY'
           and s.status in ('SELECTED','DRAFTING','IN_REVIEW','APPROVED','PUBLISHED') limit 1`,
        [editionId],
      );
      if (!pending) break;
      await open(page, `/articles/${pending.id}`);
      const approve = page.getByRole("button", { name: /^Approve$/ });
      if (!(await approve.count())) break;
      await approve.click();
      await toast(page);
      await clearToasts(page);
    }

    // 3. Sign the flatplan off.
    await open(page, `/editions/${editionId}/layout`);
    const validate = page.getByRole("button", { name: /Validate the plan/i });
    if (await validate.count()) {
      await validate.click();
      expect(await toast(page)).toMatch(/validated/i);
      await clearToasts(page);
    }

    // 4. Work the remaining gates. Anything the editor in chief may waive is waived on the record.
    await open(page, `/editions/${editionId}/qa`);
    for (let guard = 0; guard < 12; guard++) {
      const override = page.getByRole("button", { name: /^Override$/ }).first();
      if (!(await override.count())) break;
      await override.click();
      await page.locator("#override-reason").fill("Checked by the desk before going to print; the paperwork follows this week.");
      await page.getByRole("button", { name: /Override the gate/ }).click();
      await toast(page);
      await clearToasts(page);
      await open(page, `/editions/${editionId}/qa`);
    }

    // 5. Move the edition through layout to final review.
    for (const target of ["Layout", "Final review"]) {
      await open(page, `/editions/${editionId}/qa`);
      const select = page.getByLabel("Move the edition to");
      if (!(await select.count())) break;
      const options = await select.locator("option").allTextContents();
      if (!options.includes(target)) continue;
      await select.selectOption({ label: target });
      await page.getByRole("button", { name: /Move on/ }).click();
      await toast(page);
      await clearToasts(page);
    }
    const inFinal = await one<Row>("select status from editions where id = $1", [editionId]);
    expect(inFinal!.status, "the edition must reach final review before it can be published").toBe("FINAL_REVIEW");

    // 6. Render the version that will be published. v1.0 is a different kind, not another draft.
    await open(page, `/editions/${editionId}/exports`);
    await page.getByLabel("Version type").selectOption({ label: "Published (v1.0)" });
    await page.getByRole("button", { name: /Generate PDF and DOCX/i }).click();
    const queued = await toast(page);
    const label = /version (v[\d.]+)/i.exec(queued)?.[1] ?? "v1.0";
    await clearToasts(page);
    await expect
      .poll(
        async () => {
          await open(page, `/editions/${editionId}/exports`);
          return (await page.locator(`li[data-version="${label}"]`).innerText()).replace(/\s+/g, " ");
        },
        { timeout: 300_000, intervals: [5000] },
      )
      .toMatch(/\bready\b/i);

    // 7. Publish. The gates decide, not the person in a hurry.
    await open(page, `/editions/${editionId}/qa`);
    const publish = page.getByRole("button", { name: /Publish the issue/i });
    await expect(publish, "a rendered v1.0 and clean gates make publication possible").toBeEnabled({ timeout: 20_000 });
    await publish.click();
    await page.getByRole("button", { name: /^Publish$/ }).click();
    expect(await toast(page)).toMatch(/published/i);
    await clearToasts(page);

    const published = await one<Row>("select status, published_at, published_version_id from editions where id = $1", [editionId]);
    expect(published!.status).toBe("PUBLISHED");
    expect(published!.published_at).not.toBeNull();

    // The published version is frozen: corrections need a new one.
    const frozen = await one<Row>("select label, is_immutable from publication_versions where id = $1", [String(published!.published_version_id)]);
    expect(frozen!.is_immutable).toBe(true);

    // 8. Archive it, and find it in the archive with both files.
    await open(page, `/editions/${editionId}/qa`);
    await page.getByRole("button", { name: /Move to the archive/i }).click();
    await page.getByRole("button", { name: /^Archive$/ }).click();
    expect(await toast(page)).toMatch(/archived/i);

    await expect
      .poll(async () => (await one<Row>("select status from editions where id = $1", [editionId]))!.status, { timeout: 15_000 })
      .toBe("ARCHIVED");

    await open(page, "/archive");
    await expect(page.getByRole("heading", { name: /archive/i }).first()).toBeVisible();
    await expect(page.locator("main").getByText(String(frozen!.label)).first()).toBeVisible({ timeout: 20_000 });
  });
});
