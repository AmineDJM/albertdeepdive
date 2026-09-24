import { describe, expect, it } from "vitest";
import { GUIDED_PATH, resumeAt, screenFor, STEP_ORDER } from "@/lib/editorial/guided-path";
import { EDITION_STEPS, stepForStatus } from "@/lib/editorial/edition-steps";
import { EDITION_TABS } from "@/components/newsroom/nav";
import { STANDARD_ROOMS } from "@/lib/experience";
import { EDITION_STATUSES } from "@/lib/editorial/edition-state";

/**
 * The path is navigation, and the last two pieces of navigation that were written separately
 * contradicted each other in public. So these are not shape tests: each one is a way the path
 * could disagree with the timeline, with the rooms, or with itself.
 */
describe("the guided path", () => {
  it("never runs backwards through the five steps", () => {
    const steps = GUIDED_PATH.map((screen) => STEP_ORDER.get(screen.step)!);
    expect(steps.every((step) => step !== undefined)).toBe(true);
    for (let i = 1; i < steps.length; i += 1) expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
  });

  it("reaches every step of the timeline", () => {
    expect(new Set(GUIDED_PATH.map((screen) => screen.step))).toEqual(new Set(EDITION_STEPS));
  });

  it("sends no two screens to the same room", () => {
    const rooms = GUIDED_PATH.map((screen) => screen.room);
    expect(new Set(rooms).size).toBe(rooms.length);
  });

  it("opens only rooms that exist and that Standard can reach", () => {
    for (const screen of GUIDED_PATH) {
      expect(STANDARD_ROOMS.has(screen.room)).toBe(true);
      if (screen.room) expect(EDITION_TABS.some((tab) => tab.slug === screen.room)).toBe(true);
    }
  });

  it("says nothing about a room that is not on it", () => {
    expect(screenFor("layout")).toBeNull();
  });

  it("resumes where the people got to when that is further than the pipeline", () => {
    // An edition can sit collecting for a fortnight while somebody has already done the pictures.
    expect(resumeAt("e1", "OPEN", "media")).toBe("/editions/e1/media");
    // And never earlier than the edition itself has reached: a bookmark cannot undo a draft.
    expect(resumeAt("e1", "EDITORIAL_REVIEW", "ask")).toBe(resumeAt("e1", "EDITORIAL_REVIEW"));
    // A room that is not on the path is not a place to resume.
    expect(resumeAt("e1", "OPEN", "layout")).toBe(resumeAt("e1", "OPEN"));
    expect(resumeAt("e1", "OPEN", null)).toBe(resumeAt("e1", "OPEN"));
  });

  it("resumes an edition at the step the pipeline says it is on", () => {
    for (const status of EDITION_STATUSES) {
      const href = resumeAt("e1", status);
      const room = href.replace("/editions/e1", "").replace(/^\//, "");
      const screen = GUIDED_PATH.find((each) => each.room === room);
      expect(screen, status).toBeTruthy();
      expect(screen!.step, status).toBe(stepForStatus(status));
    }
  });
});
