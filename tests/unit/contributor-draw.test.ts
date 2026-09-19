import { describe, expect, it } from "vitest";
import { SCHOOL_TARGET_KEY, SELECTION_MODES, drawFromPool, isSelectionMode, rankContributors, type SelectableContributor } from "@/lib/campaigns/selection";

/**
 * "Six of these twenty-eight", which is how a person says it.
 *
 * Briefly could already draw contributors, but only per campus — because it was built for a school
 * with sites. Most newsletters have a pool and want a handful of them this month, and making them
 * express that as a per-campus target is a costume the idea wears for no reason.
 *
 * Three properties matter, and all three are about trust rather than cleverness. The draw is
 * reproducible, so the six shown before the invitations go out are the six that get them. It
 * honours the rota, so the same people are not asked every month. And it never invents anybody: a
 * pool of four asked for six gives four and says it is two short.
 */
const person = (id: string, over: Partial<SelectableContributor> = {}): SelectableContributor => ({
  id,
  campusId: null,
  groupIds: ["g1"],
  isActive: true,
  responseRate: null,
  lastInvitedAt: null,
  submissionsCount: 0,
  ...over,
});

const pool = (n: number) => Array.from({ length: n }, (_, i) => person(`p${String(i).padStart(2, "0")}`));

describe("drawing contributors from a pool", () => {
  it("takes the number asked for and no more", () => {
    const result = drawFromPool({ contributors: pool(28), groupIds: ["g1"], count: 6, seed: "edition-6" });
    expect(result.selected).toHaveLength(6);
    expect(result.pool[SCHOOL_TARGET_KEY]).toBe(28);
    expect(result.shortfall[SCHOOL_TARGET_KEY]).toBe(0);
    expect(new Set(result.selected).size, "nobody is asked twice").toBe(6);
  });

  it("gives the same six every time it is asked", () => {
    // The preview is a promise. If the draw moved between showing it and sending it, the screen
    // would be a lie in the one place a person is deciding whether to press the button.
    const once = drawFromPool({ contributors: pool(28), groupIds: ["g1"], count: 6, seed: "edition-6" });
    const twice = drawFromPool({ contributors: pool(28), groupIds: ["g1"], count: 6, seed: "edition-6" });
    expect(twice.selected).toEqual(once.selected);

    // A different edition draws a different six, or the rota would never turn.
    const next = drawFromPool({ contributors: pool(28), groupIds: ["g1"], count: 6, seed: "edition-7" });
    expect(next.selected).not.toEqual(once.selected);
  });

  it("never invents anybody, and says how short it is", () => {
    const result = drawFromPool({ contributors: pool(4), groupIds: ["g1"], count: 6, seed: "s" });
    expect(result.selected).toHaveLength(4);
    expect(result.shortfall[SCHOOL_TARGET_KEY]).toBe(2);
  });

  it("holds back the people who were asked last time", () => {
    const people = pool(10);
    const lastTime = people.slice(0, 6).map((each) => each.id);
    const result = drawFromPool({ contributors: people, groupIds: ["g1"], count: 4, seed: "s", excludeIds: lastTime, strictExclude: true });
    expect(result.selected.some((id) => lastTime.includes(id)), "the rota moves through the pool").toBe(false);
  });

  it("brings them back rather than leave an edition short, unless told not to", () => {
    const people = pool(8);
    const lastTime = people.slice(0, 6).map((each) => each.id);

    const lenient = drawFromPool({ contributors: people, groupIds: ["g1"], count: 5, seed: "s", excludeIds: lastTime });
    expect(lenient.selected, "two fresh people and three brought back beats three people").toHaveLength(5);

    const strict = drawFromPool({ contributors: people, groupIds: ["g1"], count: 5, seed: "s", excludeIds: lastTime, strictExclude: true });
    expect(strict.selected).toHaveLength(2);
    expect(strict.shortfall[SCHOOL_TARGET_KEY]).toBe(3);
  });

  it("only draws from people who are active and in the chosen groups", () => {
    const people = [
      person("in-1"),
      person("in-2"),
      person("inactive", { isActive: false }),
      person("other-group", { groupIds: ["g2"] }),
    ];
    const result = drawFromPool({ contributors: people, groupIds: ["g1"], count: 10, seed: "s" });
    expect(result.selected.sort()).toEqual(["in-1", "in-2"]);
  });

  it("prefers the people who answer, then those who have written most, then those asked longest ago", () => {
    // The same ranking the per-campus draw uses, because being drawn is not a lottery: a
    // contributor who always replies is a better ask than one who never has.
    const people = [
      person("silent", { responseRate: 0 }),
      person("reliable", { responseRate: 1 }),
      person("prolific", { responseRate: 1, submissionsCount: 9 }),
    ];
    expect(rankContributors(people, "s").map((each) => each.id)).toEqual(["prolific", "reliable", "silent"]);
    expect(drawFromPool({ contributors: people, groupIds: ["g1"], count: 1, seed: "s" }).selected).toEqual(["prolific"]);
  });

  it("asks for zero and draws nobody rather than everybody", () => {
    expect(drawFromPool({ contributors: pool(9), groupIds: ["g1"], count: 0, seed: "s" }).selected).toEqual([]);
  });

  it("names the three ways of choosing, and refuses anything else", () => {
    expect(SELECTION_MODES).toEqual(["DRAW", "GROUP", "PEOPLE"]);
    expect(isSelectionMode("DRAW")).toBe(true);
    expect(isSelectionMode("RANDOM")).toBe(false);
    expect(isSelectionMode(undefined)).toBe(false);
  });
});
