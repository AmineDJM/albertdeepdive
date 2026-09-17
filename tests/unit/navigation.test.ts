import { describe, expect, it } from "vitest";
import { AUDIENCE_TABS, INSIGHTS_TABS, NAV_ITEMS, PLATFORM_TABS, WORKBENCH_TABS, resolveNavItem, visibleTabs } from "@/components/newsroom/nav";
import type { Role } from "@/lib/auth/permissions";

const GROUPS = [WORKBENCH_TABS, AUDIENCE_TABS, INSIGHTS_TABS, PLATFORM_TABS];

describe("the sidebar", () => {
  it("offers a customer six destinations and no more", () => {
    // The whole point of the reorganisation. If this grows, the interface is drifting back.
    const shown = NAV_ITEMS.map((item) => resolveNavItem("EDITOR_IN_CHIEF", item, "/overview")).filter(Boolean);
    expect(shown).toHaveLength(6);
  });

  it("shows the platform console only to platform staff", () => {
    const platform = NAV_ITEMS.find((item) => item.href === "/platform")!;
    expect(resolveNavItem("SUPER_ADMIN", platform, "/overview")).not.toBeNull();
    for (const role of ["EDITOR_IN_CHIEF", "EDITOR", "CAMPUS_EDITOR", "VIEWER"] as Role[]) {
      expect(resolveNavItem(role, platform, "/overview"), role).toBeNull();
    }
  });

  it("never lists the same route in two places", () => {
    // Two ways to reach one screen is the thing being removed, so it is the thing to guard.
    const hrefs = GROUPS.flat().map((tab) => tab.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("points a grouped entry at the first tab its reader may open", () => {
    const audience = NAV_ITEMS.find((item) => item.href === "/subscribers")!;
    // An editor can see the subscriber list, so Audience opens there.
    expect(resolveNavItem("EDITOR", audience, "/overview")?.href).toBe("/subscribers");
    // A campus editor cannot, and gets the one tab they are allowed instead of a refusal.
    expect(resolveNavItem("CAMPUS_EDITOR", audience, "/overview")?.href).toBe("/campuses");
  });

  it("hides an entry whose every tab is out of reach", () => {
    const insights = NAV_ITEMS.find((item) => item.href === "/analytics")!;
    expect(resolveNavItem("CONTRIBUTOR", insights, "/overview")).toBeNull();
  });

  it("lights up for any of its tabs", () => {
    const workbench = NAV_ITEMS.find((item) => item.href === "/editions")!;
    expect(resolveNavItem("EDITOR", workbench, "/archive")?.active).toBe(true);
    expect(resolveNavItem("EDITOR", workbench, "/editions/abc/layout")?.active).toBe(true);
    expect(resolveNavItem("EDITOR", workbench, "/subscribers")?.active).toBe(false);
  });
});

describe("tab groups", () => {
  it("each hold more than one destination, or they would not be groups", () => {
    for (const group of GROUPS) expect(group.length).toBeGreaterThan(1);
  });

  it("collapse to nothing when a reader may open only one of them", () => {
    // HubTabs renders nothing below two: a single tab is not a choice, it is decoration.
    expect(visibleTabs("CAMPUS_EDITOR", AUDIENCE_TABS)).toHaveLength(1);
    expect(visibleTabs("EDITOR", AUDIENCE_TABS)).toHaveLength(4);
  });
});
