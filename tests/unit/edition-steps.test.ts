import { describe, expect, it } from "vitest";
import { EDITION_STEPS, STEPS, standingOf, stepForStatus, timelineFor } from "@/lib/editorial/edition-steps";
import { EDITION_STATUSES, type EditionStatus } from "@/lib/editorial/edition-state";

/**
 * Two vocabularies for one edition, and the translation between them.
 *
 * The statuses underneath are a newsroom's — GRACE_PERIOD, EDITORIAL_REVIEW, FINAL_REVIEW — and
 * every one of them is a real distinction. None of them answers "where is my newsletter up to",
 * which is the only question most people opening Briefly have. So there are five steps on top, and
 * these are the guards that keep the translation honest: every status lands somewhere, the order
 * never changes, and a step added tomorrow cannot quietly leave a status behind.
 */
describe("the five steps of an edition", () => {
  it("puts every status on the timeline, with none left behind", () => {
    for (const status of EDITION_STATUSES) {
      const step = stepForStatus(status as EditionStatus);
      expect(EDITION_STEPS, `${status} must land on a step`).toContain(step);
      expect(STEPS[step].room, `${step} must open somewhere`).toBeTruthy();
      expect(standingOf(status as EditionStatus).length, `${status} must read as something`).toBeGreaterThan(3);
    }
  });

  it("runs Contributors, Topics, Draft, Validate, Distribute, in that order, always", () => {
    expect(EDITION_STEPS).toEqual(["CONTRIBUTORS", "TOPICS", "DRAFT", "VALIDATE", "DISTRIBUTE"]);
    expect(timelineFor("OPEN").map((step) => step.label)).toEqual(["Contributors", "Topics", "Draft", "Validate", "Distribute"]);
  });

  it("marks what is behind you done, where you are current, and what is ahead not yet", () => {
    const midway = timelineFor("EDITORIAL_REVIEW");
    expect(midway.map((step) => step.state)).toEqual(["done", "done", "current", "todo", "todo"]);

    const start = timelineFor("UPCOMING");
    expect(start.map((step) => step.state)).toEqual(["current", "todo", "todo", "todo", "todo"]);

    const end = timelineFor("PUBLISHED");
    expect(end.map((step) => step.state)).toEqual(["done", "done", "done", "done", "current"]);
  });

  it("says the thing that is actually happening, not the name of the state it is in", () => {
    // The line under the edition's name in the header the user asked for:
    // "Edition #6 · October 2026 / Collecting topics".
    expect(standingOf("OPEN")).toBe("Collecting contributions");
    expect(standingOf("EDITORIAL_REVIEW")).toBe("Writing the draft");
    expect(standingOf("PUBLISHED")).toBe("Published");

    // And the few that deserve their own words, because the difference matters to whoever is waiting.
    expect(standingOf("UPCOMING"), "nobody has been invited yet, so nothing is being collected").toBe("Not started");
    expect(standingOf("GRACE_PERIOD")).toBe("Collecting — past the deadline");
    expect(standingOf("PROCESSING")).toBe("Sorting what came in");
    expect(standingOf("ARCHIVED")).toBe("Archived");
  });

  it("tells somebody who has never done this what each step is for", () => {
    for (const step of EDITION_STEPS) {
      expect(STEPS[step].purpose.length, `${step} must explain itself`).toBeGreaterThan(40);
      expect(STEPS[step].active.length).toBeGreaterThan(3);
    }
  });
});
