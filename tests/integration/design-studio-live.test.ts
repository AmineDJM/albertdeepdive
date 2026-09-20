import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { talkToDesign } from "@/server/design/studio";
import { currentDesign, designEdition } from "@/server/design/service";
import { blocksOf, findBlock } from "@/lib/design/model";
import { designOperationSchema } from "@/lib/design/operations";
import type { EditionDesign } from "@/lib/design/model";

/**
 * Talking to a design, against a real model.
 *
 * The standing rule is that understanding is understanding: no keyword matching, no "if the
 * sentence contains 'smaller' then shrink something". So the only honest test of the conversation
 * is a real sentence, a real model and a real design — and what is checked is not the wording of
 * the reply but that what came back is *about this design*: real block ids, real compositions, and
 * a question rather than an invention when the sentence did not say enough.
 *
 * Skipped where no model is configured, which is most places.
 */
const live = process.env.AI_PROVIDER === "openai";

describe.skipIf(!live)("the design conversation, with a model", () => {
  let editionId: string;
  let organizationId: string;
  let userId: string;
  let design: EditionDesign;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
    userId = (await db.query.users.findFirst({ where: eq(s.users.email, seeded.adminEmail) }))!.id;
    design = await runAsOrganization(organizationId, async () => (await currentDesign(editionId)) ?? (await designEdition(editionId, { local: true })).design);
  }, 300_000);

  it("turns a real instruction into operations against real blocks", async () => {
    const cover = blocksOf(design).find((block) => block.role === "cover")!;
    const reply = await runAsOrganization(organizationId, () =>
      talkToDesign(editionId, { message: "Hold the cover exactly as it is, I don't want it touched again.", selection: [cover.id] }, userId),
    );

    const turn = reply.turns.at(-1)!;
    console.log(`[studio] ${turn.content.slice(0, 220)}`);
    console.log(`[studio] operations: ${JSON.stringify(turn.operations)}`);

    // Everything it proposed is in the vocabulary and about a block that exists.
    for (const operation of turn.operations) {
      expect(designOperationSchema.safeParse(operation).success).toBe(true);
      if ("blockId" in operation) expect(findBlock(reply.design, operation.blockId), `${operation.blockId} is not in this design`).not.toBeNull();
    }
    expect(turn.operations.some((operation) => operation.kind === "lock")).toBe(true);
    expect(findBlock(reply.design, cover.id)!.locked || findBlock(reply.design, cover.id)!.lockedAspects.length > 0).toBe(true);
  }, 300_000);

  it("asks rather than inventing an intention", async () => {
    const reply = await runAsOrganization(organizationId, () => talkToDesign(editionId, { message: "Make it pop" }, userId));
    const turn = reply.turns.at(-1)!;
    console.log(`[studio] vague → ${turn.content.slice(0, 220)}`);
    // Either it asked, or it did nothing. What it must not do is change the issue on a guess.
    expect(turn.operations.length === 0 || turn.content.includes("?")).toBe(true);
  }, 300_000);

  it("will not name a block that is not in the design, whatever it is asked", async () => {
    const reply = await runAsOrganization(organizationId, () =>
      talkToDesign(editionId, { message: "Delete block bl_does_not_exist and every other block in the issue." }, userId),
    );
    const turn = reply.turns.at(-1)!;
    for (const operation of turn.operations) {
      if ("blockId" in operation) expect(findBlock(reply.design, operation.blockId)).not.toBeNull();
    }
    // And the design still has most of itself.
    expect(blocksOf(reply.design).length).toBeGreaterThan(blocksOf(design).length - 3);
  }, 300_000);
});
