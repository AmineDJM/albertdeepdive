import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { storageConfig } from "@/server/storage";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { StoragePanel } from "@/components/admin/storage-panel";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Where customer files actually live, and whether they are all still there.
 *
 * Its own screen rather than a line on the providers card, because the question it answers is not
 * "are the credentials saved" — that card already says so — but "is the library the customer is
 * looking at backed by anything". Those came apart on a deployment where every thumbnail was
 * broken while the console showed a perfectly healthy configuration.
 */
export default async function PlatformStoragePage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "settings:manage")) {
    return (
      <>
        <PageHeader title={tr("Storage")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Looking after the bucket is a platform job. You need to be a Briefly super admin.")}</p>
        </PageBody>
      </>
    );
  }

  const config = await storageConfig();
  const endpointHost = (() => {
    if (!config.endpoint) return null;
    try {
      return new URL(config.endpoint).host;
    } catch {
      return null;
    }
  })();

  return (
    <>
      <PageHeader title={tr("Storage")} description={tr("Every customer's originals, variants and exports live in one place. This is that place, and whether it is healthy.")} />
      <PageBody>
        <StoragePanel provider={config.provider} bucket={config.provider === "s3" ? config.bucket || null : null} endpointHost={endpointHost} localDir={config.localDir} />
      </PageBody>
    </>
  );
}
