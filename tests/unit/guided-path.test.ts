import { describe, expect, it } from "vitest";
import { GUIDED_PATH, nextFrom, resumeAt, screenFor, STEP_ORDER } from "@/lib/editorial/guided-path";
import { screenWords } from "@/components/newsroom/guided-words";
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

  it("says a word on every screen, in the dictionary", () => {
    const words = screenWords((text) => text);
    for (const screen of GUIDED_PATH) {
      expect(words[screen.key], screen.key).toBeTruthy();
      expect(words[screen.key].question).toBe(screen.question);
      if (screen.cta) expect(words[screen.key].cta).toBe(screen.cta);
    }
  });

  it("walks from the first screen to the last, one button at a time", () => {
    const visited: string[] = [GUIDED_PATH[0].room];
    let room = GUIDED_PATH[0].room;
    for (let guard = 0; guard < 20; guard += 1) {
      const next = nextFrom("e1", room);
      if (!next) break;
      room = next.href.replace("/editions/e1", "").replace(/^\//, "");
      visited.push(room);
    }
    expect(visited).toEqual(GUIDED_PATH.map((screen) => screen.room));
  });

  it("stops at the end, and says nothing about a room that is not on it", () => {
    expect(nextFrom("e1", GUIDED_PATH[GUIDED_PATH.length - 1].room)).toBeNull();
    expect(nextFrom("e1", "layout")).toBeNull();
    expect(screenFor("layout")).toBeNull();
  });

  it("labels the button from the screen it is on, not the one it opens", () => {
    // "Validate" belongs to the setup screen, which is the word the editor asked for on it; the
    // screen it opens is the one that asks what you are asking for.
    expect(nextFrom("e1", "")).toEqual({ href: "/editions/e1/ask", label: "Validate" });
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
