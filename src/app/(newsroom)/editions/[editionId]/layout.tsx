import { notFound } from "next/navigation";
import { getEdition } from "@/server/editions/service";
import { getCurrentUser } from "@/server/auth/session";
import { roleHasPermission } from "@/lib/auth/permissions";
import { EDITION_TABS } from "@/components/newsroom/nav";
import { EditionTabs } from "@/components/newsroom/edition-tabs";
import { EditionStatusBadge } from "@/components/newsroom/status-badge";

export default async function EditionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ editionId: string }> }) {
  const { editionId } = await params;
  const user = await getCurrentUser();
  const edition = await getEdition(editionId).catch(() => null);
  if (!edition || !user) notFound();
  const tabs = EDITION_TABS.filter((t) => !t.permission || roleHasPermission(user.role, t.permission)).map((t) => ({ href: `/editions/${edition.id}${t.slug ? `/${t.slug}` : ""}`, label: t.label, exact: t.slug === "" }));
  return (
    <div className="flex min-h-full flex-col">
      <div className="sticky top-0 z-30 border-b border-border bg-background">
        <div className="flex h-11 items-center gap-3 px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-semibold">
              {edition.label} <span className="text-muted-foreground">· {edition.isSpecialIssue ? "Special issue" : "Issue"} N°{edition.issueNumber}</span>
            </span>
            <EditionStatusBadge status={edition.status} />
          </div>
          <EditionTabs tabs={tabs} />
        </div>
      </div>
      {children}
    </div>
  );
}
