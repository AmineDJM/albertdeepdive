import { describe, expect, it } from "vitest";
import { selectContributors, type SelectableContributor } from "@/lib/campaigns/selection";

const PARIS = "11111111-1111-4111-8111-111111111111";
const LYON = "22222222-2222-4222-8222-222222222222";
const G_AMB = "group-ambassadors";
const G_BDD = "group-bdd";
const G_PARTNERS = "group-partners";

function c(id: string, overrides: Partial<SelectableContributor> = {}): SelectableContributor {
  return { id, campusId: PARIS, groupIds: [G_AMB], isActive: true, responseRate: null, lastInvitedAt: null, submissionsCount: 0, ...overrides };
}

describe("selectContributors", () => {
  const pool: SelectableContributor[] = [
    c("p-responsive", { responseRate: 1, submissionsCount: 3, lastInvitedAt: "2025-04-01T07:00:00Z" }),
    c("p-silent", { responseRate: 0, submissionsCount: 0, lastInvitedAt: "2025-04-01T07:00:00Z" }),
    c("p-new-a"),
    c("p-new-b"),
    c("p-inactive", { isActive: false, responseRate: 1 }),
    c("p-partner", { groupIds: [G_PARTNERS], responseRate: 1 }),
    c("l-1", { campusId: LYON, groupIds: [G_BDD], responseRate: 0.5 }),
    c("l-2", { campusId: LYON, groupIds: [G_BDD], responseRate: 1 }),
    c("s-1", { campusId: null, groupIds: [G_AMB] }),
  ];

  it("respects targets, eligibility and ranking", () => {
    const result = selectContributors({ contributors: pool, groupIds: [G_AMB, G_BDD], targets: { [PARIS]: 2, [LYON]: 5, school: 1 }, seed: "x" });
    expect(result.selected).toContain("p-responsive");
    expect(result.selected).not.toContain("p-silent"); // ranked last among Paris eligibles
    expect(result.selected).not.toContain("p-inactive");
    expect(result.selected).not.toContain("p-partner");
    expect(result.byCampus).toEqual({ [PARIS]: 2, [LYON]: 2, school: 1 });
    expect(result.shortfall).toEqual({ [PARIS]: 0, [LYON]: 3, school: 0 });
    expect(result.pool[PARIS]).toBe(4);
    // Lyon: both eligible, target exceeds the pool → take all, responsive first.
    expect(result.selected.filter((id) => id.startsWith("l-"))).toEqual(["l-2", "l-1"]);
  });

  it("ranks unknown response rates between responsive and silent contributors", () => {
    const result = selectContributors({ contributors: pool, groupIds: [G_AMB], targets: { [PARIS]: 3 }, seed: "x" });
    expect(result.selected[0]).toBe("p-responsive");
    expect(result.selected).not.toContain("p-silent");
    expect(result.selected.slice(1).sort()).toEqual(["p-new-a", "p-new-b"]);
  });

  it("ignores campuses without a target and zero targets", () => {
    const result = selectContributors({ contributors: pool, groupIds: [G_AMB, G_BDD], targets: { [PARIS]: 0 }, seed: "x" });
    expect(result.selected).toEqual([]);
    expect(result.byCampus).toEqual({});
  });

  it("is deterministic for a given seed and changes tie-breaks with another seed", () => {
    const many = Array.from({ length: 30 }, (_, i) => c(`tie-${i}`));
    const a = selectContributors({ contributors: many, groupIds: [G_AMB], targets: { [PARIS]: 10 }, seed: "seed-1" });
    const b = selectContributors({ contributors: [...many].reverse(), groupIds: [G_AMB], targets: { [PARIS]: 10 }, seed: "seed-1" });
    expect(a.selected).toEqual(b.selected);
    const other = selectContributors({ contributors: many, groupIds: [G_AMB], targets: { [PARIS]: 10 }, seed: "seed-2" });
    expect(other.selected).not.toEqual(a.selected);
    expect(other.selected).toHaveLength(10);
  });

  it("prefers the least recently invited among equals", () => {
    const list = [
      c("recent", { responseRate: 1, submissionsCount: 1, lastInvitedAt: "2026-09-01T00:00:00Z" }),
      c("older", { responseRate: 1, submissionsCount: 1, lastInvitedAt: "2026-03-01T00:00:00Z" }),
      c("never", { responseRate: 1, submissionsCount: 1, lastInvitedAt: null }),
    ];
    const result = selectContributors({ contributors: list, groupIds: [G_AMB], targets: { [PARIS]: 2 }, seed: "x" });
    expect(result.selected).toEqual(["never", "older"]);
  });

  it("holds back the previous edition's people by default (strict), reporting the shortfall", () => {
    // Paris pool eligible under G_AMB: p-responsive, p-silent, p-new-a, p-new-b (4 people).
    const excludeIds = ["p-responsive", "p-silent", "p-new-a"];
    const result = selectContributors({ contributors: pool, groupIds: [G_AMB], targets: { [PARIS]: 3 }, seed: "x", excludeIds, strictExclude: true });
    // Only p-new-b is fresh, so exactly one is chosen and two are short.
    expect(result.selected).toEqual(["p-new-b"]);
    expect(result.byCampus[PARIS]).toBe(1);
    expect(result.shortfall[PARIS]).toBe(2);
  });

  it("tops up from held-back people when not strict, freshest first", () => {
    const excludeIds = ["p-responsive", "p-silent", "p-new-a"];
    const result = selectContributors({ contributors: pool, groupIds: [G_AMB], targets: { [PARIS]: 3 }, seed: "x", excludeIds, strictExclude: false });
    // Fresh p-new-b first, then the best-ranked held-back people fill the rest.
    expect(result.selected).toHaveLength(3);
    expect(result.selected[0]).toBe("p-new-b");
    expect(result.shortfall[PARIS]).toBe(0);
  });

  it("re-invites everyone when nothing is excluded", () => {
    const result = selectContributors({ contributors: pool, groupIds: [G_AMB], targets: { [PARIS]: 4 }, seed: "x", excludeIds: [] });
    expect(result.selected).toHaveLength(4);
  });

});
