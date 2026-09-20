import { describe, expect, it } from "vitest";
import { DEFAULT_EXPERIENCE, STANDARD_ROOMS, experienceOf, isExperienceMode, onStandardPath } from "@/lib/experience";
import { AUDIENCE_TABS, EDITION_DOORS, INSIGHTS_TABS, NAV_ITEMS, SETUP_ITEMS, WORKBENCH_TABS, doorsFor, navItemsFor, resolveNavItem, settingsShown, tabsFor } from "@/components/newsroom/nav";
import { SETTINGS_NAV } from "@/components/settings/settings-nav";
import { EDITION_STEPS, STEPS } from "@/lib/editorial/edition-steps";

describe("the experience mode", () => {
  it("is Standard until a person chooses otherwise", () => {
    // The whole brief: a new user, a new organisation, an old account that never chose — Standard.
    expect(DEFAULT_EXPERIENCE).toBe("standard");
    expect(experienceOf(undefined)).toBe("standard");
    expect(experienceOf({})).toBe("standard");
    expect(experienceOf({ theme: "dark" })).toBe("standard");
    expect(experienceOf({ experience: "advanced" })).toBe("advanced");
    // Anything that is not a mode is not a mode, whatever a stale preference holds.
    expect(experienceOf({ experience: "expert" })).toBe("standard");
    expect(isExperienceMode("standard")).toBe(true);
    expect(isExperienceMode("advanced")).toBe(true);
    expect(isExperienceMode("pro")).toBe(false);
  });

  it("puts five places on the Standard sidebar, two to work and three to look after", () => {
    const nav = navItemsFor("standard");
    // The editions list left the sidebar, and then the newsletters did too: Home leads with the
    // shelf, each title carrying the edition being made and the button that starts the next, so a
    // sidebar entry to the same titles was the same answer in two places.
    expect(nav.primary.map((item) => item.href)).toEqual(["/overview", "/library"]);
    expect(nav.secondary.map((item) => item.href)).toEqual(["/subscribers", "/analytics", "/settings"]);
    // Hidden from the sidebar is not removed: the page is on Standard's way, opens from the shelf,
    // keeps its tab row, and is a door in Advanced.
    expect(onStandardPath("/publications")).toBe(true);
    expect(navItemsFor("advanced").primary.some((item) => item.href === "/publications")).toBe(true);
    // Content folds into the editions; Brand becomes a line under Settings.
    expect([...nav.primary, ...nav.secondary].some((item) => item.href === "/content" || item.href === "/settings/brand")).toBe(false);
  });

  it("leaves Advanced the full list, untouched", () => {
    const nav = navItemsFor("advanced");
    expect(nav.primary).toBe(NAV_ITEMS);
    expect(nav.secondary).toBe(SETUP_ITEMS);
  });

  it("lights Settings for the brand page in Standard, where Brand has no entry of its own", () => {
    const settings = navItemsFor("standard").secondary.find((item) => item.href === "/settings")!;
    expect(resolveNavItem("EDITOR_IN_CHIEF", settings, "/settings/brand")?.active).toBe(true);
    // And still not in Advanced, where Brand is its own door.
    expect(resolveNavItem("EDITOR_IN_CHIEF", SETUP_ITEMS.find((item) => item.href === "/settings")!, "/settings/brand")?.active).toBe(false);
  });

  it("keeps a hidden tab on the row while the reader is on it", () => {
    expect(tabsFor("standard", WORKBENCH_TABS, "/publications").map((t) => t.href)).toEqual(["/publications", "/archive"]);
    // Opened from a link, the studio still shows where it is.
    expect(tabsFor("standard", WORKBENCH_TABS, "/studio/abc").map((t) => t.href)).toEqual(["/publications", "/studio", "/archive"]);
    expect(tabsFor("standard", AUDIENCE_TABS, "/subscribers").map((t) => t.href)).toEqual(["/subscribers", "/contributors"]);
    expect(tabsFor("standard", INSIGHTS_TABS, "/analytics").map((t) => t.href)).toEqual(["/analytics"]);
    expect(tabsFor("advanced", WORKBENCH_TABS, "/publications")).toHaveLength(WORKBENCH_TABS.length);
  });

  it("lists seven settings pages in Standard and every page in Advanced", () => {
    const all = SETTINGS_NAV.flatMap((group) => group.items.map((item) => item.href));
    const standard = all.filter((href) => settingsShown("standard", href, "/settings/profile"));
    expect(standard).toEqual(["/settings/profile", "/settings/workspace", "/settings/brand", "/settings/billing", "/settings/users", "/settings/email", "/settings/help"]);
    expect(all.filter((href) => settingsShown("advanced", href, "/settings/profile"))).toEqual(all);
    // A page reached by a link is listed while the reader is on it.
    expect(settingsShown("standard", "/settings/prompts", "/settings/prompts")).toBe(true);
  });

  it("opens the doors Standard's five steps need, and keeps the room the reader is in", () => {
    /*
     * Outputs joined the list when Distribute stopped sharing a room with Validate. The two steps
     * pointed at the same publication checklist, which made one of them a lie; Distribute now
     * opens the exports, so the exports have to be somewhere Standard can reach. The count is not
     * the point — every room the five steps open being on this side of the line is.
     */
    const doors = doorsFor("standard", EDITION_DOORS, "");
    expect(doors.map((door) => door.key)).toEqual(["overview", "stories", "design", "outputs", "distribution"]);
    // Revise is in Standard beside the pictures: "make it shorter" needs no vocabulary and is the
    // simplest way there is to change an issue. The flatplan stays behind Advanced.
    expect(doors.find((door) => door.key === "design")!.rooms.map((room) => room.slug)).toEqual(["revise", "media"]);
    // Every room Standard shows is one the brief names: stories, pictures, publish.
    for (const door of doors) for (const room of door.rooms) expect(STANDARD_ROOMS.has(room.slug)).toBe(true);
    // Sent to the flatplan by a link, the reader sees the Design door with Layout in it.
    const onLayout = doorsFor("standard", EDITION_DOORS, "layout");
    expect(onLayout.find((door) => door.key === "design")!.rooms.map((room) => room.slug)).toEqual(["revise", "layout", "media"]);
    // And Advanced is the whole house.
    expect(doorsFor("advanced", EDITION_DOORS, "")).toHaveLength(EDITION_DOORS.length);

    // Every step of the timeline — which *is* the navigation in Standard — lands in a room these
    // doors contain. A step that opens a room Standard hides is a step that dead-ends.
    const reachable = new Set(doors.flatMap((door) => door.rooms.map((room) => room.slug)));
    for (const step of EDITION_STEPS) expect(reachable.has(STEPS[step].room), `${step} opens ${STEPS[step].room}`).toBe(true);
  });

  it("judges a path by its first segment", () => {
    expect(onStandardPath("/editions/123/stories")).toBe(true);
    expect(onStandardPath("/content/contributions")).toBe(false);
    expect(onStandardPath("/settings/prompts")).toBe(true);
  });
});
