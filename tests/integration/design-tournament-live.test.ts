import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { launchBrowser } from "@/server/publication/pdf";
import { runTournament, type TournamentResult } from "@/server/design/tournament";
import { designEdition } from "@/server/design/service";
import type { Browser } from "playwright";

/**
 * The tournament decided by eye.
 *
 * §41 and §82 ask for the cover to be given a competition, and a competition decided by arithmetic
 * is a competition about arithmetic. This draws real covers, shows them to a real model and keeps
 * the one it would run — which is the only version of this feature that means anything.
 *
 * Skipped where no model is configured.
 */
const live = process.env.AI_PROVIDER === "openai";

describe.skipIf(!live)("the cover tournament, decided by eye", () => {
  let browser: Browser;
  let result: TournamentResult;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, seeded.editionId) });
    browser = await launchBrowser();
    result = await runAsOrganization(edition!.organizationId!, async () => {
      await designEdition(seeded.editionId, { local: true });
      return runTournament(seeded.editionId, { scope: { kind: "cover" }, entrants: 3, browser });
    });
  }, 900_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it("shows the covers to somebody who can see them, and keeps the one they would run", () => {
    console.log(`[tournament] entrants: ${result.entrants.map((entrant) => `${entrant.label} (${entrant.score})`).join(" · ")}`);
    console.log(`[tournament] winner: ${result.entrants.find((entrant) => entrant.id === result.winner)?.label} — ${result.because}`);

    expect(result.entrants.length).toBeGreaterThan(1);
    expect(result.entrants.every((entrant) => entrant.shot)).toBe(true);
    expect(result.decidedBy).toBe("seen");
    // A reason a person could disagree with, rather than a number.
    expect(result.because.length).toBeGreaterThan(20);
    expect(result.costCents).toBeGreaterThan(0);
  }, 600_000);
});
