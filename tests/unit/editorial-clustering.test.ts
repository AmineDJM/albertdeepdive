import { describe, expect, it } from "vitest";
import { buildSimilarityMatrix, clusterSubmissions, entitySimilarity, eventDateKey, findSpellingConflicts, fuzzyNameJaccard, type ClusterInput } from "@/lib/editorial/clustering";
import { extractEntities } from "@/lib/editorial/text";
import { SEED_STORIES } from "../../seed";

/** Builds clustering inputs from the seed submissions exactly as the server module does (entities extracted by rule). */
function seedInputs(keys?: string[]): { inputs: ClusterInput[]; storyOf: Map<string, string> } {
  const inputs: ClusterInput[] = [];
  const storyOf = new Map<string, string>();
  for (const story of SEED_STORIES) {
    if (keys && !keys.includes(story.key)) continue;
    story.submissions.forEach((sub, i) => {
      const id = `${story.key}#${i}`;
      storyOf.set(id, story.key);
      const text = [sub.description, sub.peopleInvolved ? `People involved: ${sub.peopleInvolved}` : "", sub.organisationsInvolved ? `Organisations: ${sub.organisationsInvolved}` : "", sub.whyItMatters ? `Why it matters: ${sub.whyItMatters}` : ""].filter(Boolean).join("\n");
      const entities = extractEntities(text, sub.organisationsInvolved ? sub.organisationsInvolved.split(/\s*,\s*/) : []);
      inputs.push({ id, title: sub.title, text, storyType: sub.storyType, campusIds: sub.campuses, people: entities.people.map((p) => p.name), organisations: entities.organisations.map((o) => o.name), eventDate: eventDateKey({ text: sub.eventDateText ?? story.eventDateText ?? null }) });
    });
  }
  return { inputs, storyOf };
}

describe("clustering similarity", () => {
  it("groups the three Carrefour B2 submissions and keeps the Jonquille Run and Carrefour B1 apart", () => {
    const { inputs } = seedInputs(["bdd-carrefour-b2", "bdd-carrefour-b1", "campus-jonquille-run"]);
    const groups = clusterSubmissions(inputs);
    const carrefourB2 = groups.find((g) => g.ids.includes("bdd-carrefour-b2#0"));
    expect(carrefourB2?.ids.sort()).toEqual(["bdd-carrefour-b2#0", "bdd-carrefour-b2#1", "bdd-carrefour-b2#2"]);
    expect(groups.find((g) => g.ids.includes("campus-jonquille-run#0"))?.ids).toEqual(["campus-jonquille-run#0"]);
    expect(groups.find((g) => g.ids.includes("bdd-carrefour-b1#0"))?.ids).toEqual(["bdd-carrefour-b1#0"]);
    expect(carrefourB2?.primaryId).toBe("bdd-carrefour-b2#1");
  });

  it("scores same-story pairs above unrelated pairs and penalises a different cohort", () => {
    const { inputs } = seedInputs(["bdd-carrefour-b2", "bdd-carrefour-b1", "campus-jonquille-run"]);
    const m = buildSimilarityMatrix(inputs);
    const idx = (id: string) => inputs.findIndex((i) => i.id === id);
    const same = m[idx("bdd-carrefour-b2#0")][idx("bdd-carrefour-b2#2")].total;
    const otherCohort = m[idx("bdd-carrefour-b2#0")][idx("bdd-carrefour-b1#0")].total;
    const unrelated = m[idx("bdd-carrefour-b2#0")][idx("campus-jonquille-run#0")].total;
    expect(same).toBeGreaterThan(0.45);
    expect(otherCohort).toBeLessThan(0.35);
    expect(unrelated).toBeLessThan(0.15);
    expect(m[idx("bdd-carrefour-b2#1")][idx("bdd-carrefour-b2#2")].entities).toBe(1);
  });

  it("never mixes submissions of different seed stories when clustering the whole issue", () => {
    const { inputs, storyOf } = seedInputs();
    const groups = clusterSubmissions(inputs);
    for (const g of groups) {
      const stories = new Set(g.ids.map((id) => storyOf.get(id)));
      expect(stories.size, `mixed group: ${g.ids.join(", ")}`).toBe(1);
    }
    expect(groups.find((g) => g.ids.includes("campus-spi-dauphine#0"))?.ids).toHaveLength(2);
    expect(groups.length).toBeGreaterThanOrEqual(26);
  });

  it("is deterministic regardless of input order", () => {
    const { inputs } = seedInputs();
    const a = clusterSubmissions(inputs).map((g) => g.ids.join("+")).sort();
    const b = clusterSubmissions([...inputs].reverse()).map((g) => g.ids.join("+")).sort();
    expect(a).toEqual(b);
  });
});

describe("entity and date helpers", () => {
  it("matches near-identical spellings when comparing names", () => {
    expect(fuzzyNameJaccard(["Nathan Sarfaty", "Enzo Natali"], ["Nathan Serfaty", "Enzo Natali"])).toBe(1);
    expect(fuzzyNameJaccard(["Nathan Sarfaty"], ["Madeleine Landry"])).toBe(0);
    expect(entitySimilarity(["Albert Crew", "Flore Jaskulké"], ["Albert Crew", "Flore Jaskulke", "Joseph Abdo", "Oscar Mathey"])).toBeGreaterThan(0.6);
  });

  it("finds spelling conflicts across sources", () => {
    const conflicts = findSpellingConflicts([
      { id: "a", names: ["Nathan Sarfaty", "Sacha Nardoux"] },
      { id: "b", names: ["Nathan Serfaty", "Sacha Nardoux"] },
    ]);
    expect(conflicts).toEqual([{ a: "Nathan Sarfaty", b: "Nathan Serfaty", ids: ["a", "b"] }]);
  });

  it("normalises event dates to a comparable day-month key", () => {
    expect(eventDateKey({ text: "Friday 4 April" })).toBe("4 april");
    expect(eventDateKey({ text: "Friday 4th April 2025" })).toBe("4 april");
    expect(eventDateKey({ iso: "2025-04-04" })).toBe("4 april");
    expect(eventDateKey({ text: "April, five days" })).toBeNull();
  });
});
