import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  EDITION_STATUSES,
  EditionTransitionError,
  isCollecting,
  isEditable,
  nextStatuses,
  phaseForStatus,
} from "@/lib/editorial/edition-state";

describe("edition state machine", () => {
  it("follows the happy path in order", () => {
    const path = [
      "UPCOMING",
      "OPEN",
      "REMINDER_1",
      "REMINDER_2",
      "GRACE_PERIOD",
      "CLOSED",
      "PROCESSING",
      "EDITORIAL_REVIEW",
      "LAYOUT",
      "FINAL_REVIEW",
      "PUBLISHED",
      "ARCHIVED",
    ] as const;
    for (let i = 0; i < path.length - 1; i++)
      expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
  it("allows skipping reminders when closing early", () => {
    expect(canTransition("OPEN", "CLOSED")).toBe(true);
    expect(canTransition("REMINDER_1", "CLOSED")).toBe(true);
  });
  it("rejects impossible jumps", () => {
    expect(canTransition("UPCOMING", "PUBLISHED")).toBe(false);
    expect(canTransition("PUBLISHED", "OPEN")).toBe(false);
    expect(canTransition("ARCHIVED", "PUBLISHED")).toBe(false);
    expect(() => assertTransition("OPEN", "PUBLISHED")).toThrow(EditionTransitionError);
  });
  it("lets editors go back from layout and final review", () => {
    expect(canTransition("LAYOUT", "EDITORIAL_REVIEW")).toBe(true);
    expect(canTransition("FINAL_REVIEW", "LAYOUT")).toBe(true);
  });
  it("exposes phases and predicates", () => {
    expect(phaseForStatus("OPEN")).toBe("COLLECT");
    expect(phaseForStatus("LAYOUT")).toBe("LAYOUT");
    expect(phaseForStatus("ARCHIVED")).toBe("PUBLISH");
    expect(isCollecting("REMINDER_2")).toBe(true);
    expect(isEditable("PUBLISHED")).toBe(false);
    for (const status of EDITION_STATUSES) expect(Array.isArray(nextStatuses(status))).toBe(true);
  });
});
