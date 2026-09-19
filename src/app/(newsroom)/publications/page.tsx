import Link from "next/link";
import { BookOpen, Globe, Library, Mail, Printer } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { listPublications } from "@/server/outputs/service";
import { readerPaymentsFor } from "@/server/payments/readers";
import { describePrice } from "@/lib/payments";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Badge } from "@/components/ui/badge";
import { PublicationEditor } from "./publication-editor";
import { ShowcaseCard } from "./showcase-card";
import { showcaseStatusFor } from "@/server/showcase/consent";
import { enumLabel } from "@/lib/utils";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

const FORMAT_ICONS = { EMAIL: Mail, WEB: Globe, MAGAZINE: BookOpen, PRINT: Printer } as const;

export default async function PublicationsPage() {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  const [publications, payments, showcase] = await Promise.all([listPublications(tenant.organizationId), readerPaymentsFor(tenant.organizationId), showcaseStatusFor(tenant.organizationId)]);
  const canManage = hasPermission(user, "edition:create");
  const paymentsConnected = Boolean(payments);

  return (
    <>
      <PageHeader
        title={tr("Publications")}
        description={tr("Your recurring titles. Open one to see its editions and start the next.")}
        actions={canManage ? <PublicationEditor paymentsConnected={paymentsConnected} /> : null}
      />
      <PageBody className="space-y-4">
        <DataTable
          rows={publications}
          rowKey={(p) => p.id}
          empty={{
            title: tr("No titles yet"),
            description: tr("A title is a recurring publication — a weekly email, a monthly magazine, a quarterly report."),
            icon: Library,
          }}
          columns={[
            {
              key: "name",
              header: tr("Title"),
              cell: (p) => (
                <span className="flex flex-col">
                  <Link href={`/publications/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  {p.description ? <span className="line-clamp-1 text-xs text-muted-foreground">{p.description}</span> : null}
                </span>
              ),
            },
            {
              key: "formats",
              header: tr("Usual formats"),
              cell: (p) => (
                <span className="flex items-center gap-1.5">
                  {p.defaultFormats.length ? (
                    p.defaultFormats.map((f) => {
                      const Icon = FORMAT_ICONS[f as keyof typeof FORMAT_ICONS];
                      return Icon ? (
                        <span key={f} title={tr(enumLabel(f))} className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Icon className="size-3.5" />
                        </span>
                      ) : null;
                    })
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </span>
              ),
            },
            { key: "cadence", header: tr("Cadence"), cell: (p) => <span className="text-xs capitalize">{p.cadence}</span> },
            { key: "language", header: tr("Language"), cell: (p) => <span className="text-xs uppercase">{p.language}</span> },
            {
              key: "access",
              header: tr("Access"),
              cell: (p) => (p.access === "paid" && p.priceCents ? <span className="text-xs">{describePrice(p.priceCents, p.priceCurrency, p.priceInterval)}</span> : <span className="text-xs text-muted-foreground">{tr("Free")}</span>),
            },
            { key: "editions", header: tr("Editions"), cell: (p) => <span className="tabular">{p.editions}</span>, align: "right" },
            { key: "published", header: tr("Published"), cell: (p) => <span className="tabular">{p.published}</span>, align: "right" },
            { key: "subscribers", header: tr("Subscribers"), cell: (p) => <span className="tabular">{p.subscribers}</span>, align: "right" },
            {
              key: "status",
              header: tr("Status"),
              cell: (p) => <Badge variant={p.status === "ACTIVE" ? "default" : "muted"}>{tr(enumLabel(p.status))}</Badge>,
            },
            {
              key: "subscribe",
              header: tr("Subscribe link"),
              cell: (p) =>
                p.isPublic && p.subscribeSlug ? (
                  <Link href={`/s/${p.subscribeSlug}`} className="font-mono text-2xs text-muted-foreground underline-offset-4 hover:underline" data-no-row-link>
                    /s/{p.subscribeSlug}
                  </Link>
                ) : (
                  <span className="text-2xs text-muted-foreground">{tr("Private")}</span>
                ),
            },
            ...(canManage
              ? [
                  {
                    key: "actions",
                    header: "",
                    cell: (p: (typeof publications)[number]) => (
                      <span data-no-row-link>
                        <PublicationEditor publication={p} paymentsConnected={paymentsConnected} />
                      </span>
                    ),
                    align: "right" as const,
                    width: "60px",
                  },
                ]
              : []),
          ]}
        />
        <ShowcaseCard rows={showcase} canManage={canManage} />
      </PageBody>
    </>
  );
}
