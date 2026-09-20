import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { directEditionDesign, explain } from "@/server/design/director";
import { currentDesign, designEdition, designHistory, restoreDesign } from "@/server/design/service";
import { blocksOf } from "@/lib/design/model";

/**
 * The director, on a real edition.
 *
 * Run without a model on purpose. What is being checked is the floor: an edition composed from the
 * material alone must still read as edited — a cover, a lead with room around it, sections, short
 * pieces gathered, a close — because that is what a customer gets when the model is unavailable,
 * misconfigured or slow, and "a design that is merely good beats a dialog box" is only true if the
 * merely good one exists.
 */
describe("directing a real edition", () => {
  let editionId: string;
  let organizationId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
  }, 180_000);

  it("reads the edition, plans it, and says what it did", async () => {
    const directed = await runAsOrganization(organizationId, () => directEditionDesign(editionId, { local: true }));

    expect(directed.source).toBe("local");
    // Nothing was spent: no model was asked.
    expect(directed.costCents).toBe(0);

    // It read something real.
    expect(directed.signals.counts.stories).toBeGreaterThan(0);
    expect(directed.signals.counts.words).toBeGreaterThan(100);

    // And planned a publication rather than a list.
    const kinds = directed.plan.surfaces.map((surface) => surface.kind);
    expect(kinds[0]).toBe("cover");
    expect(kinds[kinds.length - 1]).toBe("close");
    expect(directed.plan.surfaces.length).toBeGreaterThan(3);

    const roles = directed.plan.surfaces.flatMap((surface) => surface.blocks.map((block) => block.role));
    expect(roles).toContain("masthead");
    expect(roles).toContain("cover");
    expect(roles.some((role) => role === "lead" || role === "feature")).toBe(true);

    // Every block that claims a story points at one that is in the edition.
    const articles = new Set(directed.document.articles.map((article) => article.id));
    for (const surface of directed.plan.surfaces) {
      for (const block of surface.blocks) {
        if (block.articleId) expect(articles.has(block.articleId), `${block.role} points at ${block.articleId}`).toBe(true);
      }
    }
  }, 120_000);

  it("explains itself in the editor's words, not the engine's", async () => {
    const directed = await runAsOrganization(organizationId, () => directEditionDesign(editionId, { local: true }));
    const explained = explain(directed);
    expect(explained.narrative.length).toBeGreaterThan(20);
    expect(explained.direction).toMatch(/airy|measured|dense/);
    // The engine's vocabulary never reaches a person. A number may: a headline about a 0.4% uplift
    // is the edition's own words, and quoting it back is the point of the sentence.
    expect(`${explained.narrative} ${explained.direction}`).not.toMatch(/constraint|solver|schema|genome|scaleRatio|emphasisSpread|repeatLimit|fieldsPerSurface/i);
    // The direction is generated rather than quoted, so it carries no numbers at all.
    expect(explained.direction).not.toMatch(/\d/);
  }, 120_000);

  it("plans the same edition the same way twice, so a render can be reproduced", async () => {
    const first = await runAsOrganization(organizationId, () => directEditionDesign(editionId, { local: true }));
    const second = await runAsOrganization(organizationId, () => directEditionDesign(editionId, { local: true }));
    const shape = (plan: typeof first.plan) => plan.surfaces.map((surface) => [surface.kind, surface.intent, surface.density, surface.blocks.map((block) => [block.role, block.articleId])]);
    expect(shape(first.plan)).toEqual(shape(second.plan));
  }, 180_000);

  it("places every story it read somewhere", async () => {
    const directed = await runAsOrganization(organizationId, () => directEditionDesign(editionId, { local: true }));
    const placed = new Set(directed.plan.surfaces.flatMap((surface) => surface.blocks.map((block) => block.articleId).filter(Boolean)));
    // The cover repeats the lead, so placed ⊇ stories rather than equality.
    for (const story of directed.signals.stories) {
      expect(placed.has(story.articleId), `“${story.headline}” is nowhere in the plan`).toBe(true);
    }
  }, 120_000);
});

describe("composing and keeping a design", () => {
  let editionId: string;
  let organizationId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;
  }, 180_000);

  afterAll(async () => {
    await db.delete(s.editionDesigns).where(eq(s.editionDesigns.editionId, editionId));
  });

  it("designs a real edition and stores what it designed", async () => {
    const result = await runAsOrganization(organizationId, () => designEdition(editionId, { local: true }));
    expect(result.revision).toBe(0);
    expect(result.source).toBe("local");

    const blocks = blocksOf(result.design);
    expect(blocks.length).toBeGreaterThan(5);
    expect(blocks.some((block) => block.role === "cover")).toBe(true);
    // Every block says what it is and why it is drawn that way.
    for (const block of blocks) expect(block.rationale, `${block.role}`).toBeTruthy();

    const current = await runAsOrganization(organizationId, () => currentDesign(editionId));
    expect(current?.revision).toBe(0);
    expect(blocksOf(current!).length).toBe(blocks.length);
  }, 180_000);

  it("keeps every revision, and restores one as a new revision rather than by rewriting", async () => {
    const first = await runAsOrganization(organizationId, () => designEdition(editionId, { local: true }));
    const second = await runAsOrganization(organizationId, () => designEdition(editionId, { local: true }));
    expect(second.revision).toBe(first.revision + 1);

    const restored = await runAsOrganization(organizationId, () => restoreDesign(editionId, first.revision));
    // A restore is the next revision, so "what did we send" stays answerable.
    expect(restored.revision).toBe(second.revision + 1);

    const history = await runAsOrganization(organizationId, () => designHistory(editionId));
    expect(history[0].revision).toBe(restored.revision);
    expect(history[0].summary).toContain("Restored");
    expect(history.filter((row) => row.isCurrent)).toHaveLength(1);
  }, 240_000);
});
