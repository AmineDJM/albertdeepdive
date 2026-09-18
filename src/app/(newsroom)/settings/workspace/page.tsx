import { requireTenant } from "@/server/tenancy/context";
import { getOrganization, listMembers } from "@/server/tenancy/service";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Badge } from "@/components/ui/badge";
import { WorkspaceForm } from "./workspace-form";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function WorkspaceSettingsPage() {
  const tr = await getUi();
  const tenant = await requireTenant();
  const [organization, members] = await Promise.all([getOrganization(tenant.organizationId), listMembers(tenant.organizationId)]);
  const canEdit = tenant.role === "OWNER" || tenant.role === "ADMIN";
  const colours = (organization.brandColours ?? {}) as { primary?: string; accent?: string };

  return (
    <>
      <PageHeader title={tr("Workspace")} description={tr("Who you are, and how you look to your readers.")} />
      <PageBody className="space-y-8">
        <WorkspaceForm
          canEdit={canEdit}
          initial={{
            slug: organization.slug,
            name: organization.name,
            type: organization.type,
            website: organization.website ?? "",
            description: organization.description ?? "",
            locale: organization.locale === "fr" ? "fr" : "en",
            timezone: organization.timezone,
            country: organization.country ?? "",
            logoUrl: organization.logoUrl ?? "",
            primary: colours.primary ?? "",
            accent: colours.accent ?? "",
          }}
        />

        <section className="max-w-2xl">
          <SectionTitle>{tr("Members")}</SectionTitle>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{member.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                </span>
                <Badge variant={member.role === "OWNER" ? "default" : "muted"}>{member.role.toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            {tr("Workspace roles decide what someone can do here. Platform roles, in Users & roles, decide what they can do in the newsroom.")}</p>
        </section>
      </PageBody>
    </>
  );
}
