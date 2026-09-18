import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { getTenant } from "@/server/tenancy/context";
import { SettingsNav } from "@/components/settings/settings-nav";
import { getUi } from "@/server/i18n/locale";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), getTenant()]);
  if (!user) redirect("/login");
  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-[calc(100vh-3rem)] w-[208px] shrink-0 overflow-y-auto border-r border-border bg-sidebar/60 px-2 py-3 scrollbar-thin md:block" aria-label={tr("Settings navigation")}>
        <SettingsNav role={user.role} workspaceRole={tenant?.role ?? null} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
