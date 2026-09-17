import Link from "next/link";
import { BookOpen, Globe, Library, Mail, Printer } from "lucide-react";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { listPublications } from "@/server/outputs/service";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { DataTable } from "@/components/newsroom/data-table";
import { Badge } from "@/components/ui/badge";
import { PublicationEditor } from "./publication-editor";
import { enumLabel } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FORMAT_ICONS = { EMAIL: Mail, WEB: Globe, MAGAZINE: BookOpen, PRINT: Printer } as const;

export default async function PublicationsPage() {
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  const publications = await listPublications(tenant.organizationId);
  const canManage = hasPermission(user, "edition:create");

  return (
    <>
      <PageHeader
        title="Publications"
        description="Your recurring titles. An edition belongs to one; where it is published is decided edition by edition."
        actions={canManage ? <PublicationEditor /> : null}
      />
      <PageBody>
        <DataTable
          rows={publications}
          rowKey={(p) => p.id}
          empty={{
            title: "No titles yet",
            description: "A title is a recurring publication — a weekly email, a monthly magazine, a quarterly report.",
            icon: Library,
          }}
          columns={[
            {
              key: "name",
              header: "Title",
              cell: (p) => (
                <span className="flex flex-col">
                  <span className="font-medium">{p.name}</span>
                  {p.description ? <span className="line-clamp-1 text-xs text-muted-foreground">{p.description}</span> : null}
                </span>
              ),
            },
            {
              key: "formats",
              header: "Usual formats",
              cell: (p) => (
                <span className="flex items-center gap-1.5">
                  {p.defaultFormats.length ? (
                    p.defaultFormats.map((f) => {
                      const Icon = FORMAT_ICONS[f as keyof typeof FORMAT_ICONS];
                      return Icon ? (
                        <span key={f} title={enumLabel(f)} className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
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
            { key: "cadence", header: "Cadence", cell: (p) => <span className="text-xs capitalize">{p.cadence}</span> },
            { key: "language", header: "Language", cell: (p) => <span className="text-xs uppercase">{p.language}</span> },
            { key: "editions", header: "Editions", cell: (p) => <span className="tabular">{p.editions}</span>, align: "right" },
            { key: "published", header: "Published", cell: (p) => <span className="tabular">{p.published}</span>, align: "right" },
            { key: "subscribers", header: "Subscribers", cell: (p) => <span className="tabular">{p.subscribers}</span>, align: "right" },
            {
              key: "status",
              header: "Status",
              cell: (p) => <Badge variant={p.status === "ACTIVE" ? "default" : "muted"}>{enumLabel(p.status)}</Badge>,
            },
            {
              key: "subscribe",
              header: "Subscribe link",
              cell: (p) =>
                p.isPublic && p.subscribeSlug ? (
                  <Link href={`/s/${p.subscribeSlug}`} className="font-mono text-2xs text-muted-foreground underline-offset-4 hover:underline" data-no-row-link>
                    /s/{p.subscribeSlug}
                  </Link>
                ) : (
                  <span className="text-2xs text-muted-foreground">Private</span>
                ),
            },
            ...(canManage
              ? [
                  {
                    key: "actions",
                    header: "",
                    cell: (p: (typeof publications)[number]) => (
                      <span data-no-row-link>
                        <PublicationEditor publication={p} />
                      </span>
                    ),
                    align: "right" as const,
                    width: "60px",
                  },
                ]
              : []),
          ]}
        />
      </PageBody>
    </>
  );
}
