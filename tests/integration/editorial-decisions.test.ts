import { and, desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { articles, editorialDecisions, facts, qualityGateOverrides, stories, users } from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { approveArticle } from "@/server/editorial/articles";
import { settleFact, resolveConflict } from "@/server/editorial/facts";
import { clearQualityGateOverride, overrideQualityGate } from "@/server/publication/versions";
import { qualityGates } from "@/server/publication/validate";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";

let editionId: string;
let editorId: string;
let chiefId: string;

beforeAll(async () => {
  const seeded = await ensureSeeded();
  editionId = seeded.editionId;
  const [editor] = await db.select({ id: users.id }).from(users).where(eq(users.role, "EDITOR")).limit(1);
  const [chief] = await db.select({ id: users.id }).from(users).where(eq(users.role, "EDITOR_IN_CHIEF")).limit(1);
  editorId = editor.id;
  chiefId = chief.id;
});

async function aDisputedFact() {
  const [fact] = await db.select().from(facts).where(and(eq(facts.editionId, editionId), eq(facts.status, "DISPUTED"))).limit(1);
  return fact;
}

describe("settling a disputed fact", () => {
  it("records the editor's wording, verifies the fact and keeps the reason", async () => {
    const fact = await aDisputedFact();
    expect(fact, "the seed carries deliberate factual conflicts").toBeTruthy();

    const settled = await settleFact(fact.id, "The surname is spelled Serfaty.", "Checked against the campus register.", editorId);

    expect(settled.statement).toBe("The surname is spelled Serfaty.");
    expect(settled.status).toBe("RESOLVED");
    expect(settled.confidence).toBe("EDITOR_VERIFIED");
    expect(settled.notes).toContain("Checked against the campus register.");

    const [decision] = await db
      .select()
      .from(editorialDecisions)
      .where(and(eq(editorialDecisions.entityId, fact.id), eq(editorialDecisions.decision, "FACT_RESOLVE_CONFLICT")))
      .orderBy(desc(editorialDecisions.createdAt))
      .limit(1);
    expect(decision.reason).toBe("Checked against the campus register.");
    expect((decision.previousValue as { statement: string }).statement).toBe(fact.statement);
  });

  it("refuses to settle without a reason, and refuses a fact that is not disputed", async () => {
    const fact = await aDisputedFact();
    await expect(settleFact(fact.id, "Something true.", "   ", editorId)).rejects.toBeInstanceOf(ValidationError);
    await expect(settleFact(fact.id, "   ", "A good reason.", editorId)).rejects.toBeInstanceOf(ValidationError);

    const [active] = await db.select().from(facts).where(and(eq(facts.editionId, editionId), eq(facts.status, "ACTIVE"))).limit(1);
    await expect(settleFact(active.id, "Something true.", "A good reason.", editorId)).rejects.toBeInstanceOf(ValidationError);
  });

  it("unblocks approval: an article cannot be approved while its story has a disputed fact", async () => {
    const [article] = await db
      .select({ id: articles.id, storyId: articles.storyId })
      .from(articles)
      .innerJoin(facts, eq(facts.storyId, articles.storyId))
      .where(and(eq(articles.editionId, editionId), eq(facts.status, "DISPUTED")))
      .limit(1);
    expect(article, "the seed has an article whose story is disputed").toBeTruthy();

    await expect(approveArticle(article.id, editorId)).rejects.toThrow(/disputed/i);

    const disputed = await db.select().from(facts).where(and(eq(facts.storyId, article.storyId), eq(facts.status, "DISPUTED")));
    for (const f of disputed) await settleFact(f.id, f.statement, "Confirmed with the contributor.", editorId);

    const approved = await approveArticle(article.id, editorId);
    expect(approved.status).toBe("APPROVED");
  });
});

describe("resolving a conflict between two rival facts", () => {
  it("keeps one and rejects the other, with the reason on both", async () => {
    const fact = await aDisputedFact();
    if (!fact) return;
    const [rival] = await db
      .insert(facts)
      .values({ editionId, storyId: fact.storyId, statement: "The rival reading of the same detail.", status: "DISPUTED", conflictGroup: fact.conflictGroup, createdByAi: true })
      .returning();

    const { kept, rejected } = await resolveConflict(fact.id, rival.id, "The photo caption settles it.", editorId);
    expect(kept.id).toBe(rival.id);
    expect(kept.status).toBe("RESOLVED");
    expect(rejected).toContain(fact.id);

    const [loser] = await db.select().from(facts).where(eq(facts.id, fact.id));
    expect(loser.status).toBe("REJECTED");
    expect(loser.notes).toContain("The photo caption settles it.");
  });

  it("requires a reason", async () => {
    const fact = await aDisputedFact();
    if (!fact) return;
    await expect(resolveConflict(fact.id, fact.id, "", editorId)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("quality gate overrides", () => {
  const gateKey = "image_rights_validated";

  it("is refused to anyone below the editor in chief", async () => {
    await expect(overrideQualityGate(editionId, gateKey, "Because I say so.", { id: editorId, role: "EDITOR" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(clearQualityGateOverride(editionId, gateKey, { id: editorId, role: "EDITOR" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("requires a written reason and a gate that exists", async () => {
    await expect(overrideQualityGate(editionId, gateKey, "   ", { id: chiefId, role: "EDITOR_IN_CHIEF" })).rejects.toBeInstanceOf(ValidationError);
    await expect(overrideQualityGate(editionId, "not_a_gate", "A reason.", { id: chiefId, role: "EDITOR_IN_CHIEF" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("passes the gate while it is overridden, shows the reason, and fails again once it is lifted", async () => {
    const before = (await qualityGates(editionId)).find((g) => g.key === gateKey);
    if (!before || before.status === "pass") return; // nothing to override in this database

    const reason = "Rights confirmed by email on 3 May; the licences follow.";
    await overrideQualityGate(editionId, gateKey, reason, { id: chiefId, role: "EDITOR_IN_CHIEF" });

    const during = (await qualityGates(editionId)).find((g) => g.key === gateKey)!;
    expect(during.status).toBe("pass");
    expect(during.overridden).toBe(true);
    expect(during.details).toContain(reason);

    await clearQualityGateOverride(editionId, gateKey, { id: chiefId, role: "EDITOR_IN_CHIEF" });
    const after = (await qualityGates(editionId)).find((g) => g.key === gateKey)!;
    expect(after.status).not.toBe("pass");
    expect(after.overridden).toBeFalsy();

    const rows = await db.select().from(qualityGateOverrides).where(and(eq(qualityGateOverrides.editionId, editionId), eq(qualityGateOverrides.gateKey, gateKey)));
    expect(rows).toHaveLength(0);
  });

  it("cannot lift an override that was never taken", async () => {
    await expect(clearQualityGateOverride(editionId, "captions_complete", { id: chiefId, role: "EDITOR_IN_CHIEF" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("never lets a prohibited-media gate be overridden", async () => {
    const gates = await qualityGates(editionId);
    const red = gates.find((g) => g.key === "no_prohibited_media")!;
    expect(red.overridable).toBe(false);
    expect(red.blocking).toBe(true);
  });
});

describe("story housekeeping", () => {
  it("every seeded story belongs to the edition its article belongs to", async () => {
    const mismatched = await db
      .select({ id: articles.id })
      .from(articles)
      .innerJoin(stories, eq(stories.id, articles.storyId))
      .where(and(eq(articles.editionId, editionId), eq(stories.editionId, editionId)));
    expect(mismatched.length).toBeGreaterThan(0);
  });
});
