import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { launchBrowser } from "@/server/publication/pdf";
import { runTournament, type TournamentResult } from "@/server/design/tournament";
import { currentDesign, designEdition, designHistory } from "@/server/design/service";
import { blocksOf } from "@/lib/design/model";
import type { Browser } from "playwright";

/**
 * A cover tournament on a real edition.
 *
 * Run without a model, so the arithmetic decides — which is the floor §41 has to clear anyway:
 * more than one cover is drawn, each is really laid out, and the one that is kept is the one that
 * measured best rather than the one that happened to be composed first.
 */
describe("the cover tournament", () => {
  let editionId: string;
  let organizationId: string;
  let browser: Browser;
  let result: TournamentResult;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
    browser = await launchBrowser();
    result = await runAsOrganization(organizationId, async () => {
      await designEdition(editionId, { local: true });
      return runTournament(editionId, { scope: { kind: "cover" }, entrants: 3, local: true, browser });
    });
  }, 600_000);

  afterAll(async () => {
    await browser?.close().catch(() => {});
  });

  it("draws more than one cover", () => {
    expect(result.entrants.length).toBeGreaterThan(1);
    for (const entrant of result.entrants) {
      expect(entrant.label.length).toBeGreaterThan(0);
      expect(entrant.score).toBeGreaterThan(0);
      // Every entrant was laid out, so the page it would be judged on is known.
      expect(entrant.page).toBe(1);
    }
  });

  it("keeps the one that won, and says why", () => {
    expect(result.entrants.some((entrant) => entrant.id === result.winner)).toBe(true);
    expect(result.because.length).toBeGreaterThan(10);
    expect(result.decidedBy).toBe("measured");
    expect(result.costCents).toBe(0);
  });

  it("does not spend a revision when the design already had it right", async () => {
    const winner = result.entrants.find((entrant) => entrant.id === result.winner)!;
    const history = await runAsOrganization(organizationId, () => designHistory(editionId));
    if (winner.current) {
      expect(result.changed).toBe("Nothing changed.");
      expect(history[0].summary).not.toContain("tournament");
    } else {
      expect(result.changed).not.toBe("Nothing changed.");
      expect(history[0].summary).toContain("tournament");
    }
  }, 120_000);

  it("leaves the issue with a cover whatever it chose", async () => {
    const design = await runAsOrganization(organizationId, () => currentDesign(editionId));
    expect(blocksOf(design!).some((block) => block.role === "cover")).toBe(true);
  }, 120_000);
});
