import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { listDesignTurns, talkToDesign, writeDesign } from "@/server/design/studio";
import { currentDesign, designEdition, designHistory, saveDesign } from "@/server/design/service";
import { applyOperations } from "@/lib/design/apply";
import { readSignals } from "@/lib/design/signals";
import { directionFor } from "@/server/design/identity";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { blocksOf, findBlock, withBlock } from "@/lib/design/model";
import { COMPOSITIONS, type BlockRole } from "@/lib/design/roles";

/**
 * Talking to a real design, with no model connected.
 *
 * Two things are being proved. The first is the floor from §100: with nothing connected, the
 * assistant says so in a sentence a person can act on and changes nothing — it does not guess at
 * "quieter" by matching words. The second is that everything underneath the conversation works on
 * a real edition anyway: the operations, the locks, the revisions and the history are the same
 * whether a sentence or a button asked for them.
 */
describe("the design conversation on a real edition", () => {
  let editionId: string;
  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
    const admin = await db.query.users.findFirst({ where: eq(s.users.email, seeded.adminEmail) });
    userId = admin!.id;
    await runAsOrganization(organizationId, () => designEdition(editionId, { local: true }));
  }, 300_000);

  it("says plainly that it cannot read the request, and changes nothing", async () => {
    const before = await runAsOrganization(organizationId, () => currentDesign(editionId));
    const reply = await runAsOrganization(organizationId, () => talkToDesign(editionId, { message: "Make the cover quieter" }, userId));

    expect(reply.turns.at(-1)!.role).toBe("assistant");
    expect(reply.turns.at(-1)!.content).toContain("no language model is connected");
    expect(reply.changed).toBe("Nothing changed.");
    expect(reply.revision).toBe(before!.revision);
  }, 120_000);

  it("keeps the thread, and what was selected when it was said", async () => {
    const design = await runAsOrganization(organizationId, () => currentDesign(editionId));
    const block = blocksOf(design!)[1];
    await runAsOrganization(organizationId, () => talkToDesign(editionId, { message: "Not like that", selection: [block.id] }, userId));

    const turns = await runAsOrganization(organizationId, () => listDesignTurns(editionId));
    const asked = turns.filter((turn) => turn.role === "user").at(-1)!;
    expect(asked.content).toBe("Not like that");
    expect(asked.selection).toEqual([block.id]);
    // And the reply is attached to the same selection, so the thread reads as a conversation.
    expect(turns.at(-1)!.selection).toEqual([block.id]);
  }, 120_000);

  it("forgets a selection that is not in the design", async () => {
    await runAsOrganization(organizationId, () => talkToDesign(editionId, { message: "This one", selection: ["bl_nothing"] }, userId));
    const turns = await runAsOrganization(organizationId, () => listDesignTurns(editionId));
    expect(turns.filter((turn) => turn.role === "user").at(-1)!.selection).toEqual([]);
  }, 120_000);

  it("carries out a change on the real design, and writes it into the history", async () => {
    const outcome = await runAsOrganization(organizationId, async () => {
      const design = (await currentDesign(editionId))!;
      const document = await buildEditionDocument(editionId, { versionLabel: "design", includeUnapproved: true });
      const { resolved: direction } = await directionFor(editionId);
      const block = blocksOf(design).find((candidate) => COMPOSITIONS[candidate.role as BlockRole].length > 1)!;
      const wanted = COMPOSITIONS[block.role as BlockRole].find((candidate) => candidate !== block.composition)!;

      const applied = applyOperations(design, [{ kind: "set_composition", blockId: block.id, composition: wanted }], { signals: readSignals(document), direction });
      const saved = await saveDesign(editionId, applied.design, { summary: "the block is drawn differently" });
      return { blockId: block.id, wanted, revision: saved.revision, done: applied.outcomes[0].done };
    });

    expect(outcome.done).toBe(true);
    const now = await runAsOrganization(organizationId, () => currentDesign(editionId));
    expect(findBlock(now!, outcome.blockId)!.composition).toBe(outcome.wanted);

    const history = await runAsOrganization(organizationId, () => designHistory(editionId));
    expect(history[0].revision).toBe(outcome.revision);
    expect(history[0].summary).toContain("drawn differently");
    // The revision before it is still there, unchanged. That is what makes undo honest.
    expect(history.length).toBeGreaterThan(1);
  }, 180_000);

  it("refuses to change a block somebody has held", async () => {
    const result = await runAsOrganization(organizationId, async () => {
      const design = (await currentDesign(editionId))!;
      const document = await buildEditionDocument(editionId, { versionLabel: "design", includeUnapproved: true });
      const { resolved: direction } = await directionFor(editionId);
      const block = blocksOf(design)[1];
      const held = withBlock(design, block.id, (current) => ({ ...current, locked: true }));
      return applyOperations(held, [{ kind: "set_importance", blockId: block.id, importance: "BRIEF" }], { signals: readSignals(document), direction });
    });
    expect(result.outcomes[0].done).toBe(false);
    expect(result.outcomes[0].what).toContain("held");
  }, 120_000);

  it("writes the design out in a form that names every block it could be asked about", async () => {
    const design = await runAsOrganization(organizationId, () => currentDesign(editionId));
    const written = writeDesign(design!, new Map());
    for (const block of blocksOf(design!)) expect(written).toContain(block.id);
    // And nothing that belongs to the words rather than to the design.
    expect(written).not.toContain("<p");
  }, 120_000);
});
