import { describe, expect, it } from "vitest";
import { AUDIENCE_TABS, CONTENT_TABS, EDITION_DOORS, INSIGHTS_TABS, NAV_ITEMS, SETUP_ITEMS, WORKBENCH_TABS, editionDoorFor, resolveNavItem, visibleTabs } from "@/components/newsroom/nav";
import { HEX, HUES, HUE_MEANING, PALETTE } from "@/lib/brand/palette";

const GROUPS = [CONTENT_TABS, WORKBENCH_TABS, AUDIENCE_TABS, INSIGHTS_TABS];

describe("the sidebar", () => {
  it("offers a customer six destinations and no more", () => {
    // The whole point of the reorganisation. If this grows, the interface is drifting back.
    const shown = NAV_ITEMS.map((item) => resolveNavItem("EDITOR_IN_CHIEF", item, "/overview")).filter(Boolean);
    expect(shown).toHaveLength(6);
  });

  it("keeps the console off the customer's list altogether", () => {
    // Running Briefly is a different job with its own door; it is never a sidebar entry here.
    expect([...NAV_ITEMS, ...SETUP_ITEMS].some((item) => item.href.startsWith("/admin") || item.href.startsWith("/admin"))).toBe(false);
  });

  it("lights Brand and Settings for their own paths only", () => {
    const brand = SETUP_ITEMS.find((item) => item.href === "/settings/brand")!;
    const settings = SETUP_ITEMS.find((item) => item.href === "/settings")!;
    expect(resolveNavItem("EDITOR_IN_CHIEF", brand, "/settings/brand")?.active).toBe(true);
    expect(resolveNavItem("EDITOR_IN_CHIEF", settings, "/settings/brand")?.active).toBe(false);
    expect(resolveNavItem("EDITOR_IN_CHIEF", settings, "/settings/billing")?.active).toBe(true);
    // A reader with no say in the editions has no business at the brand's door either.
    expect(resolveNavItem("VIEWER", brand, "/overview")).toBeNull();
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
    const workbench = NAV_ITEMS.find((item) => item.href === "/publications")!;
    expect(resolveNavItem("EDITOR", workbench, "/archive")?.active).toBe(true);
    // An edition's workspace is not one of its tabs any more — the list left the sidebar — but it
    // still belongs to this part of the product, so the sidebar says so.
    expect(resolveNavItem("EDITOR", workbench, "/editions/abc/layout")?.active).toBe(true);
    expect(resolveNavItem("EDITOR", workbench, "/publications")?.href).toBe("/publications");
    expect(resolveNavItem("EDITOR", workbench, "/subscribers")?.active).toBe(false);
  });
});

describe("an edition's doors", () => {
  it("put every earlier tab behind one door, and only one", () => {
    // Eleven tabs became six doors; nothing was removed and nothing is reachable twice.
    const slugs = EDITION_DOORS.flatMap((door) => door.rooms.map((room) => room.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of ["", "campaign", "inbox", "stories", "articles", "media", "layout", "qa", "exports", "audio", "settings"]) expect(editionDoorFor(slug), slug).not.toBeNull();
    expect(EDITION_DOORS.length).toBeLessThanOrEqual(6);
  });

  it("open Stories on the stories themselves, not on the inbox", () => {
    expect(editionDoorFor("inbox")?.rooms[0].slug).toBe("stories");
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

describe("the spectrum", () => {
  it("gives every area a hue of its own", () => {
    // Two areas sharing a colour is worse than no colour at all: it teaches the wrong thing.
    const hues = NAV_ITEMS.map((item) => item.hue);
    expect(new Set(hues).size).toBe(hues.length);
  });

  it("says what each hue is for", () => {
    // A palette without assignments becomes decoration within a month.
    for (const hue of HUES) {
      expect(HUE_MEANING[hue], hue).toBeTruthy();
      expect(HEX[hue], hue).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it("holds lightness and chroma constant so no hue shouts over its neighbours", () => {
    // The whole trick behind a palette that looks designed: pick the hues freely, then hold
    // everything else absolutely still.
    const lightness = HUES.map((hue) => PALETTE[hue].solid.match(/oklch\(([\d.]+)/)![1]);
    expect(new Set(lightness).size).toBe(1);
    for (const hue of HUES) {
      const [, l, c] = PALETTE[hue].soft.match(/oklch\(([\d.]+) ([\d.]+)/)!;
      expect(Number(l), `${hue} soft`).toBeGreaterThan(0.9);
      expect(Number(c), `${hue} soft`).toBeLessThan(0.05);
    }
  });
});
