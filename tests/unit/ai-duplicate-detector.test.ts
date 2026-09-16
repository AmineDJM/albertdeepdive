import { describe, expect, it } from "vitest";
import { detectDuplicate, normalizeForHash, textHash } from "@/server/ai/services/duplicate-detector";
import { BDD_STORIES } from "../../seed/stories-bdd";
import { CAMPUS_STORIES } from "../../seed/stories-campus";

const carrefour = BDD_STORIES.find((s) => s.key === "bdd-carrefour-b2")!;
const jonquille = CAMPUS_STORIES.find((s) => s.key === "campus-jonquille-run")!;
const khadidja = carrefour.submissions[0].description;
const sacha = carrefour.submissions[1].description;
const run = jonquille.submissions[0].description;

describe("duplicate detection", () => {
  it("hashes normalised text so whitespace, case and punctuation do not matter", () => {
    expect(normalizeForHash("  Enzo NATALI, Nathan Sarfaty!  ")).toBe("enzo natali nathan sarfaty");
    expect(textHash("Friday 4 April,  on a sunny afternoon")).toBe(textHash("friday 4 april on a sunny afternoon."));
  });

  it("flags an identical re-submission as an exact duplicate of the earlier one", () => {
    const r = detectDuplicate({ id: "new", text: khadidja }, [{ id: "old", text: khadidja }, { id: "other", text: run }]);
    expect(r).toMatchObject({ duplicateOfId: "old", exact: true, similarity: 1 });
  });

  it("flags a near-copy (one sentence dropped) above the 0.85 threshold", () => {
    const sentences = sacha.split(/(?<=\.)\s+/);
    const trimmed = sentences.slice(0, -1).join(" ");
    const r = detectDuplicate({ id: "new", text: trimmed }, [{ id: "old", text: sacha }, { id: "other", text: run }]);
    expect(r.duplicateOfId).toBe("old");
    expect(r.exact).toBe(false);
    expect(r.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it("does not flag different submissions about the same story, nor unrelated ones", () => {
    expect(detectDuplicate({ id: "a", text: khadidja }, [{ id: "b", text: sacha }, { id: "c", text: run }]).duplicateOfId).toBeNull();
    expect(detectDuplicate({ id: "a", text: run }, [{ id: "b", text: sacha }]).duplicateOfId).toBeNull();
  });

  it("ignores itself and very short texts", () => {
    expect(detectDuplicate({ id: "a", text: khadidja }, [{ id: "a", text: khadidja }]).duplicateOfId).toBeNull();
    expect(detectDuplicate({ id: "a", text: "Photos from the final" }, [{ id: "b", text: "Photos from the final." }]).exact).toBe(true);
    expect(detectDuplicate({ id: "a", text: "Photos from the final" }, [{ id: "b", text: "Photos from the finals" }]).duplicateOfId).toBeNull();
  });
});
