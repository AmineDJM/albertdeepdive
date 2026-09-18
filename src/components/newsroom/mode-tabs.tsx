"use client";

import { usePathname } from "next/navigation";
import type { ExperienceMode } from "@/lib/experience";
import { tabsFor } from "./nav";
import { TabBar } from "./tab-bar";

/** A tab row that knows the mode; see `tabsFor`. One tab left is no row at all. */
export function ModeTabs({ mode, tabs }: { mode: ExperienceMode; tabs: { href: string; label: string; exact?: boolean }[] }) {
  const pathname = usePathname();
  const shown = tabsFor(mode, tabs, pathname);
  if (shown.length < 2) return null;
  return <TabBar tabs={shown} />;
}
