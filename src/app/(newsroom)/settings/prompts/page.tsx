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

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  const user = await getCurrentUser();
  if (!hasPermission(user, "prompt:manage")) return <NoAccess title="Prompts" permission="prompt:manage" />;
  const prompts = await listPrompts();
  const categories = [...new Set(prompts.map((p) => p.category))].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  const customised = prompts.filter((p) => !p.isDefault).length;
  const calls = prompts.reduce((n, p) => n + p.usage.calls, 0);
  const cost = prompts.reduce((n, p) => n + p.usage.costCents, 0);
  return (
    <>
      <PageHeader title="Prompts" description="Every AI step runs a versioned template. Edit, test, activate — the pipeline picks up the active version within 30 seconds." />
      <PageBody className="space-y-5">
        <StatGrid columns={4}>
          <Stat label="Prompt templates" value={prompts.length} hint={`${customised} customised · ${prompts.length - customised} on shipped defaults`} />
          <Stat label="Versions" value={prompts.reduce((n, p) => n + p.versions, 0)} hint="kept forever, one active per key" />
          <Stat label="Calls (all time)" value={formatNumber(calls)} hint="from the AI trace" />
          <Stat label="Estimated cost" value={formatCurrency(cost / 100)} hint="sum of ai_jobs.cost_cents" />
        </StatGrid>
        {categories.map((category) => (
          <section key={category}>
            <SectionTitle>{CATEGORY_LABELS[category] ?? category}</SectionTitle>
            <DataTable
              rows={prompts.filter((p) => p.category === category)}
              rowKey={(p) => p.key}
              onRowHref={(p) => `/settings/prompts/${p.key}`}
              dense
              empty={{ title: "No prompts", icon: Cpu }}
              columns={[
                {
                  key: "name",
                  header: "Prompt",
                  cell: (p) => (
                    <div className="min-w-0">
                      <Link href={`/settings/prompts/${p.key}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="truncate font-mono text-2xs text-muted-foreground">{p.key}</div>
                    </div>
                  ),
                },
                { key: "description", header: "Does", cell: (p) => <span className="line-clamp-1 max-w-md text-xs text-muted-foreground">{p.description ?? "—"}</span> },
                { key: "version", header: "Active", cell: (p) => (p.activeVersion ? <Badge variant={p.isDefault ? "outline" : "brand"}>v{p.activeVersion}{p.isDefault ? " · default" : ""}</Badge> : <Badge variant="muted">code default</Badge>) },
                { key: "tier", header: "Tier", cell: (p) => <Badge variant={p.modelTier === "STRONG" ? "default" : "secondary"}>{p.modelTier}</Badge> },
                { key: "temp", header: "Temp.", cell: (p) => <span className="tabular text-xs">{p.temperature}</span>, align: "right" },
                { key: "tokens", header: "Max tokens", cell: (p) => <span className="tabular text-xs">{formatNumber(p.maxOutputTokens)}</span>, align: "right" },
                { key: "calls", header: "Calls", cell: (p) => <span className="tabular text-xs">{formatNumber(p.usage.calls)}</span>, align: "right" },
                { key: "cost", header: "Cost", cell: (p) => <span className="tabular text-xs">{p.usage.costCents ? formatCurrency(p.usage.costCents / 100) : "—"}</span>, align: "right" },
                { key: "updated", header: "Updated", cell: (p) => <span className="text-xs text-muted-foreground">{p.updatedAt ? formatDate(p.updatedAt) : "—"}</span> },
              ]}
            />
          </section>
        ))}
      </PageBody>
    </>
  );
}
