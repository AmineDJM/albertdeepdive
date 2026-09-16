import { describe, expect, it } from "vitest";
import {
  calendarDaysUntil,
  campaignPhaseAt,
  computeCampaignSchedule,
  describeSchedule,
  nextEditionMonth,
  timezoneOffsetMinutes,
  zonedTimeToUtc,
} from "@/lib/campaigns/schedule";

const defaults = { openDay: 1, openHour: 9, reminder1Day: 4, reminder2Day: 7, graceDay: 8, publicationDay: 15, finalReviewDay: 11 };

describe("computeCampaignSchedule", () => {
  it("uses CEST (UTC+2) for an October edition", () => {
    const s = computeCampaignSchedule({ month: 10, year: 2026, defaults });
    expect(s.opensAt.toISOString()).toBe("2026-10-01T07:00:00.000Z");
    expect(s.reminder1At.toISOString()).toBe("2026-10-04T07:00:00.000Z");
    expect(s.reminder2At.toISOString()).toBe("2026-10-07T07:00:00.000Z");
    expect(s.deadlineAt.toISOString()).toBe("2026-10-07T21:59:00.000Z");
    expect(s.graceEndsAt.toISOString()).toBe("2026-10-08T21:59:00.000Z");
    expect(s.publicationTargetAt.toISOString()).toBe("2026-10-15T08:00:00.000Z");
    expect(s.finalReviewAt.toISOString()).toBe("2026-10-11T16:00:00.000Z");
  });

  it("uses CET (UTC+1) for a winter edition", () => {
    const s = computeCampaignSchedule({ month: 1, year: 2027, defaults });
    expect(s.opensAt.toISOString()).toBe("2027-01-01T08:00:00.000Z");
    expect(s.deadlineAt.toISOString()).toBe("2027-01-07T22:59:00.000Z");
    expect(s.graceEndsAt.toISOString()).toBe("2027-01-08T22:59:00.000Z");
  });

  it("handles the DST switch inside the month (March 2027: switch on the 28th)", () => {
    const s = computeCampaignSchedule({ month: 3, year: 2027, defaults: { ...defaults, publicationDay: 30 } });
    expect(s.opensAt.toISOString()).toBe("2027-03-01T08:00:00.000Z"); // still CET
    expect(s.publicationTargetAt.toISOString()).toBe("2027-03-30T08:00:00.000Z"); // CEST after the switch
  });

  it("clamps days beyond the end of the month", () => {
    const s = computeCampaignSchedule({ month: 2, year: 2027, defaults: { ...defaults, graceDay: 31, publicationDay: 30 } });
    expect(s.graceEndsAt.toISOString()).toBe("2027-02-28T22:59:00.000Z");
    expect(s.publicationTargetAt.toISOString()).toBe("2027-02-28T09:00:00.000Z");
  });

  it("keeps the dates ordered", () => {
    const s = computeCampaignSchedule({ month: 6, year: 2027, defaults });
    expect(s.opensAt < s.reminder1At).toBe(true);
    expect(s.reminder1At < s.reminder2At).toBe(true);
    expect(s.reminder2At < s.deadlineAt).toBe(true);
    expect(s.deadlineAt < s.graceEndsAt).toBe(true);
    expect(s.graceEndsAt < s.finalReviewAt).toBe(true);
    expect(s.finalReviewAt < s.publicationTargetAt).toBe(true);
  });
});

describe("timezone helpers", () => {
  it("computes the Paris offset in winter and summer", () => {
    expect(timezoneOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(60);
    expect(timezoneOffsetMinutes(new Date("2026-07-15T12:00:00Z"))).toBe(120);
  });

  it("converts wall-clock times on the day of the DST switch", () => {
    // 29 March 2026 02:00 CET → 03:00 CEST; 04:00 local is 02:00 UTC.
    expect(zonedTimeToUtc(2026, 3, 29, 4, 0).toISOString()).toBe("2026-03-29T02:00:00.000Z");
    // 25 October 2026: clocks go back at 03:00 CEST → 02:00 CET; 12:00 local is 11:00 UTC.
    expect(zonedTimeToUtc(2026, 10, 25, 12, 0).toISOString()).toBe("2026-10-25T11:00:00.000Z");
  });

  it("finds the next edition month across a year boundary", () => {
    expect(nextEditionMonth(new Date("2026-09-16T10:00:00Z"))).toEqual({ month: 10, year: 2026 });
    expect(nextEditionMonth(new Date("2026-12-31T23:30:00Z"))).toEqual({ month: 2, year: 2027 }); // already 1 Jan in Paris
    expect(nextEditionMonth(new Date("2026-12-31T22:30:00Z"))).toEqual({ month: 1, year: 2027 });
  });

  it("counts calendar days in Paris time", () => {
    const deadline = new Date("2026-10-07T21:59:00Z"); // 7 Oct 23:59 Paris
    expect(calendarDaysUntil(deadline, new Date("2026-10-04T07:00:00Z"))).toBe(3);
    expect(calendarDaysUntil(deadline, new Date("2026-10-07T07:00:00Z"))).toBe(0);
    expect(calendarDaysUntil(deadline, new Date("2026-10-07T22:30:00Z"))).toBe(-1); // already 8 Oct in Paris
  });
});

describe("campaignPhaseAt", () => {
  const campaign = computeCampaignSchedule({ month: 10, year: 2026, defaults });

  it("walks through every phase", () => {
    expect(campaignPhaseAt(campaign, new Date("2026-09-30T12:00:00Z"))).toBe("SCHEDULED");
    expect(campaignPhaseAt(campaign, new Date("2026-10-01T07:00:00Z"))).toBe("OPEN");
    expect(campaignPhaseAt(campaign, new Date("2026-10-04T07:00:00Z"))).toBe("REMINDER_1");
    expect(campaignPhaseAt(campaign, new Date("2026-10-07T07:00:00Z"))).toBe("REMINDER_2");
    expect(campaignPhaseAt(campaign, new Date("2026-10-07T22:00:00Z"))).toBe("GRACE_PERIOD");
    expect(campaignPhaseAt(campaign, new Date("2026-10-08T22:00:00Z"))).toBe("CLOSED");
  });

  it("respects an explicit closed status", () => {
    expect(campaignPhaseAt({ ...campaign, status: "CLOSED" }, new Date("2026-10-02T07:00:00Z"))).toBe("CLOSED");
    expect(campaignPhaseAt({ ...campaign, closedAt: new Date("2026-10-02T07:00:00Z") }, new Date("2026-10-02T08:00:00Z"))).toBe("CLOSED");
  });
});

describe("describeSchedule", () => {
  it("produces human lines with Paris times", () => {
    const lines = describeSchedule(computeCampaignSchedule({ month: 10, year: 2026, defaults }));
    expect(lines.map((l) => l.line)).toEqual([
      "Contribution request — 1 Oct, 09:00",
      "Reminder #1 — Day 4 · 4 Oct, 09:00",
      "Reminder #2 — Day 7 · 7 Oct, 09:00",
      "Deadline — 7 Oct, 23:59",
      "Grace period — until 8 Oct, 23:59",
      "Campaign closes — 8 Oct, 23:59",
    ]);
  });
});
