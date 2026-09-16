import { notFound } from "next/navigation";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { CATEGORY_LABELS, getPromptDetail } from "@/server/settings/prompts";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { Badge } from "@/components/ui/badge";
import { NoAccess } from "@/components/settings/no-access";
import { formatCurrency, formatDateTime, formatNumber } from "@/lib/utils";
import { PromptEditor } from "./prompt-editor";

export const dynamic = "force-dynamic";

export default async function PromptDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const user = await getCurrentUser();
  if (!hasPermission(user, "prompt:manage")) return <NoAccess title="Prompts" permission="prompt:manage" />;
  const detail = await getPromptDetail(key).catch(() => null);
  if (!detail) notFound();
  const usage = detail.usage;
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Prompts", href: "/settings/prompts" }, { label: detail.name }]}
        title={detail.name}
        description={detail.description ?? undefined}
        meta={
          <>
            <Badge variant="outline">{CATEGORY_LABELS[detail.category] ?? detail.category}</Badge>
            <span className="font-mono text-2xs text-muted-foreground">{detail.key}</span>
            {detail.active ? <Badge variant="success">v{detail.active.version} active</Badge> : <Badge variant="muted">code default</Badge>}
          </>
        }
        actions={
          <span className="text-2xs text-muted-foreground">
            {formatNumber(usage.calls)} calls · {usage.failed} failed · {usage.avgLatencyMs ? `${formatNumber(usage.avgLatencyMs)} ms avg` : "no latency data"} · {formatCurrency(usage.costCents / 100)}
            {usage.lastUsedAt ? ` · last ${formatDateTime(usage.lastUsedAt)}` : ""}
          </span>
        }
      />
      <PageBody>
        <PromptEditor key={`${detail.key}-${detail.active?.id ?? "default"}-${detail.versions.length}`} detail={detail} />
      </PageBody>
    </>
  );
}
