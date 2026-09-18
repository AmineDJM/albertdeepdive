import { getCurrentUser } from "@/server/auth/session";
import { getTranslations } from "@/server/i18n/locale";
import { visibleTabs, type SubTab } from "./nav";
import { ModeTabs } from "./mode-tabs";
import { experienceOf } from "@/lib/experience";

/**
 * The tab row a grouped workspace page shows.
 *
 * Pages pass the group they belong to and nothing else: who is reading and what language they read
 * in are resolved here, so four pages that belong together cannot drift into four different tab
 * bars. A reader who may only open one of the tabs sees none — a single tab is not a choice.
 */
export async function HubTabs({ tabs }: { tabs: readonly SubTab[] }) {
  const [user, t] = await Promise.all([getCurrentUser(), getTranslations()]);
  if (!user) return null;
  const allowed = visibleTabs(user.role, tabs);
  if (allowed.length < 2) return null;
  return (
    <div className="px-3">
      <ModeTabs mode={experienceOf(user.preferences)} tabs={allowed.map((tab) => ({ href: tab.href, label: t(tab.label), exact: tab.exact }))} />
    </div>
  );
}
