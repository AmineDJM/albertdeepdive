import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, Plus, User } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { getTenant } from "@/server/tenancy/context";
import { listMyOrganizationsDetailed } from "@/server/tenancy/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrganizationRow } from "./organization-row";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Which organisations are yours, and what you are in each.
 *
 * The switcher in the sidebar answers "where am I"; it cannot answer "what am I allowed to do
 * here", "who else is in this one", or "how do I start another" — and those are the questions
 * somebody has the moment they belong to more than one. A role is shown as a word rather than
 * assumed: half of "why can I not change this?" is not knowing you are a viewer.
 */
export default async function OrganizationsPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [mine, tenant] = await Promise.all([listMyOrganizationsDetailed(user.id), getTenant()]);

  return (
    <>
      <PageHeader
        title={tr("Your organisations")}
        description={tr("Every workspace you belong to, and what you are in each one.")}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/onboarding">
              <Plus className="size-3.5" /> {tr("New organisation")}
            </Link>
          </Button>
        }
      />
      <PageBody className="max-w-3xl space-y-4">
        {mine.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {mine.map((organization) => (
              <OrganizationRow key={organization.id} organization={organization} current={organization.id === tenant?.organizationId} />
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <Building2 className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-[13px]">{tr("You are not in any organisation yet.")}</p>
            <Button asChild size="sm" className="mt-3">
              <Link href="/onboarding">{tr("Create one")}</Link>
            </Button>
          </div>
        )}

        <div className="rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
          <p className="flex items-start gap-2">
            <User className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {tr("An organisation on your own is a real workspace: it has its newsletters, its audience and its brand. Nobody else is in it until you add them, and a newsletter can be handed to a team later without losing anything.")}
            </span>
          </p>
        </div>

        <p className="text-2xs text-muted-foreground">
          {tr("Adding people and changing their role happens inside a workspace, under Workspace.")}{" "}
          <Link href="/settings/workspace" className="underline underline-offset-4">
            {tr("Workspace")}
          </Link>
          {mine.some((o) => o.role === "VIEWER" || o.role === "CONTRIBUTOR") ? (
            <>
              {" · "}
              <Badge variant="muted">{tr("Some roles here cannot change settings")}</Badge>
            </>
          ) : null}
        </p>
      </PageBody>
    </>
  );
}
