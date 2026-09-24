import { describe, expect, it } from "vitest";
import { planFromDeadline } from "@/lib/campaigns/schedule";
import { LAST_SETUP_ROOM, resumeAt } from "@/lib/editorial/guided-path";

const DAY = 86_400_000;

/**
 * One date decides the others, and one function decides how.
 *
 * The screen showed the reminders that had last been saved, so moving the last day moved nothing
 * until the page came back: a card reading "4 Nov" under a field reading 20 September. Computing
 * them on the screen is only safe if it is the same computation the server performs, which is why
 * this is one exported function rather than two that agree today.
 */
describe("what one date does to the others", () => {
  const opensAt = new Date("2026-11-01T08:00:00Z");

  it("puts the reminders inside the span and the grace day after the end", () => {
    const plan = planFromDeadline({ opensAt, deadlineAt: new Date("2026-11-11T22:59:00Z"), unsent: true })!;
    expect(plan).toBeTruthy();
    expect(plan.movedOpening).toBe(false);
    expect(plan.opensAt.getTime()).toBe(opensAt.getTime());
    expect(plan.reminder1At.getTime()).toBeGreaterThan(plan.opensAt.getTime());
    expect(plan.reminder2At.getTime()).toBeGreaterThan(plan.reminder1At.getTime());
    expect(plan.reminder2At.getTime()).toBeLessThan(plan.deadlineAt.getTime());
    expect(plan.graceEndsAt.getTime() - plan.deadlineAt.getTime()).toBe(DAY);
  });

  it("moves with the date rather than staying where it was saved", () => {
    const near = planFromDeadline({ opensAt, deadlineAt: new Date("2026-11-05T22:59:00Z"), unsent: true })!;
    const far = planFromDeadline({ opensAt, deadlineAt: new Date("2026-11-25T22:59:00Z"), unsent: true })!;
    expect(far.reminder1At.getTime()).toBeGreaterThan(near.reminder1At.getTime());
    expect(far.graceEndsAt.getTime()).toBeGreaterThan(near.graceEndsAt.getTime());
  });

  it("reads a last day before the opening as 'ask them now', but only while nothing has gone", () => {
    const now = new Date("2026-09-20T18:00:00Z");
    const soon = new Date("2026-09-20T21:59:00Z");
    const unsent = planFromDeadline({ opensAt, deadlineAt: soon, unsent: true, now })!;
    expect(unsent.movedOpening).toBe(true);
    expect(unsent.opensAt.getTime()).toBe(now.getTime());
    expect(unsent.reminder1At.getTime()).toBeGreaterThan(now.getTime());
    expect(unsent.reminder2At.getTime()).toBeLessThan(soon.getTime());

    // Already out, or a date that has itself gone by: there is no sensible schedule to invent.
    expect(planFromDeadline({ opensAt, deadlineAt: soon, unsent: false, now })).toBeNull();
    expect(planFromDeadline({ opensAt, deadlineAt: new Date("2026-09-19T21:59:00Z"), unsent: true, now })).toBeNull();
    expect(planFromDeadline({ opensAt, deadlineAt: new Date("nonsense"), unsent: true, now })).toBeNull();
  });
});

/**
 * The path stops where the edition does.
 *
 * Everything from the fifth screen on is about what came back, and nothing comes back until the
 * invitation has gone — so walking on to the pictures and the topics was walking through empty
 * rooms and calling it progress.
 */
describe("the path waits for the invitation", () => {
  const id = "11111111-1111-1111-1111-111111111111";

  it("brings somebody back to the thing left to do rather than past it", () => {
    expect(resumeAt(id, "UPCOMING", "topics", { invitationSent: false })).toBe(`/editions/${id}/${LAST_SETUP_ROOM}`);
    expect(resumeAt(id, "UPCOMING", "topics", { invitationSent: true })).toBe(`/editions/${id}/topics`);
    expect(resumeAt(id, "UPCOMING", "ask", { invitationSent: false })).toBe(`/editions/${id}/ask`);
  });
});
