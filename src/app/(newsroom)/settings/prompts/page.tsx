import Link from "next/link";
import { Cpu } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { CATEGORY_LABELS, CATEGORY_ORDER, listPrompts } from "@/server/settings/prompts";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Stat, StatGrid } from "@/components/newsroom/stat";
import { Badge } from "@/components/ui/badge";
import { NoAccess } from "@/components/settings/no-access";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const tr = await getUi();
  const user = await getCurrentUser();
  if (!hasPermission(user, "prompt:manage")) return <NoAccess title={tr("Prompts")} permission="prompt:manage" />;
  const prompts = await listPrompts();
  const categories = [...new Set(prompts.map((p) => p.category))].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  const customised = prompts.filter((p) => !p.isDefault).length;
  const calls = prompts.reduce((n, p) => n + p.usage.calls, 0);
  const cost = prompts.reduce((n, p) => n + p.usage.costCents, 0);
  return (
    <>
      <PageHeader title={tr("Prompts")} description={tr("Every AI step runs a versioned template. Edit, test, activate — the pipeline picks up the active version within 30 seconds.")} />
      <PageBody className="space-y-5">
        <StatGrid columns={4}>
          <Stat label={tr("Prompt templates")} value={prompts.length} hint={`${customised} customised · ${prompts.length - customised} on shipped defaults`} />
          <Stat label={tr("Versions")} value={prompts.reduce((n, p) => n + p.versions, 0)} hint={tr("kept forever, one active per key")} />
          <Stat label={tr("Calls (all time)")} value={formatNumber(calls)} hint={tr("from the AI trace")} />
          <Stat label={tr("Estimated cost")} value={formatCurrency(cost / 100)} hint={tr("sum of ai_jobs.cost_cents")} />
        </StatGrid>
        {categories.map((category) => (
          <section key={category}>
            <SectionTitle>{CATEGORY_LABELS[category] ?? category}</SectionTitle>
            <DataTable
              rows={prompts.filter((p) => p.category === category)}
              rowKey={(p) => p.key}
              onRowHref={(p) => `/settings/prompts/${p.key}`}
              dense
              empty={{ title: tr("No prompts"), icon: Cpu }}
              columns={[
                {
                  key: "name",
                  header: tr("Prompt"),
                  cell: (p) => (
                    <div className="min-w-0">
                      <Link href={`/settings/prompts/${p.key}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="truncate font-mono text-2xs text-muted-foreground">{p.key}</div>
                    </div>
                  ),
                },
                { key: "description", header: tr("Does"), cell: (p) => <span className="line-clamp-1 max-w-md text-xs text-muted-foreground">{p.description ?? "—"}</span> },
                { key: "version", header: tr("Active"), cell: (p) => (p.activeVersion ? <Badge variant={p.isDefault ? "outline" : "brand"}>v{p.activeVersion}{p.isDefault ? " · default" : ""}</Badge> : <Badge variant="muted">{tr("code default")}</Badge>) },
                { key: "tier", header: tr("Tier"), cell: (p) => <Badge variant={p.modelTier === "STRONG" ? "default" : "secondary"}>{p.modelTier}</Badge> },
                { key: "temp", header: tr("Temp."), cell: (p) => <span className="tabular text-xs">{p.temperature}</span>, align: "right" },
                { key: "tokens", header: tr("Max tokens"), cell: (p) => <span className="tabular text-xs">{formatNumber(p.maxOutputTokens)}</span>, align: "right" },
                { key: "calls", header: tr("Calls"), cell: (p) => <span className="tabular text-xs">{formatNumber(p.usage.calls)}</span>, align: "right" },
                { key: "cost", header: tr("Cost"), cell: (p) => <span className="tabular text-xs">{p.usage.costCents ? formatCurrency(p.usage.costCents / 100) : "—"}</span>, align: "right" },
                { key: "updated", header: tr("Updated"), cell: (p) => <span className="text-xs text-muted-foreground">{p.updatedAt ? formatDate(p.updatedAt) : "—"}</span> },
              ]}
            />
          </section>
        ))}
      </PageBody>
    </>
  );
}
