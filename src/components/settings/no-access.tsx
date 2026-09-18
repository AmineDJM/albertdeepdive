import { Lock } from "lucide-react";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { getUi } from "@/server/i18n/locale";

export async function NoAccess({ title, permission }: { title: string; permission: string }) {
  const tr = await getUi();
  return (
    <>
      <PageHeader title={title} />
      <PageBody>
        <EmptyState icon={Lock} title={tr("You don't have access to this screen")} description={`This screen requires the "${permission}" permission. Ask a super admin to adjust your role.`} />
      </PageBody>
    </>
  );
}
