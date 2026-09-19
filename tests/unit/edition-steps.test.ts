import { describe, expect, it } from "vitest";
import { EDITION_STEPS, STEPS, standingOf, stepForStatus, timelineFor } from "@/lib/editorial/edition-steps";
import { EDITION_STATUSES, type EditionStatus } from "@/lib/editorial/edition-state";
import { STANDARD_ROOMS } from "@/lib/experience";

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

  it("sends no two steps to the same place, and none of them somewhere else's name", () => {
    /*
     * The bug this exists for was visible on screen and nobody saw it: the tab row said "Topics"
     * and opened the topics board, the timeline said "Topics" and opened the *stories* board, and
     * Validate and Distribute both opened the publication checklist. One word, two destinations;
     * two words, one destination. Now that the steps are the navigation in Standard mode, that is
     * not untidiness, it is a menu that lies.
     */
    const rooms = EDITION_STEPS.map((step) => STEPS[step].room);
    expect(new Set(rooms).size, `two steps share a room: ${rooms.join(", ")}`).toBe(rooms.length);

    // And each one opens the room its name promises.
    expect(STEPS.TOPICS.room).toBe("topics");
    expect(STEPS.VALIDATE.room).toBe("qa");
    expect(STEPS.DISTRIBUTE.room, "distributing is not the same act as approving").toBe("exports");
  });

  it("opens only rooms Standard can actually reach", () => {
    // A step whose room is hidden in Standard is a step that dead-ends for the people the steps
    // were written for.
    for (const step of EDITION_STEPS) {
      expect(STANDARD_ROOMS.has(STEPS[step].room), `${step} opens ${STEPS[step].room}, which Standard hides`).toBe(true);
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
