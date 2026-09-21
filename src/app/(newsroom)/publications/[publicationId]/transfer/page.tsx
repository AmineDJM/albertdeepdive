import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getCurrentUser, hasPermission } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { PageBody, PageHeader } from "@/components/newsroom/page-header";
import { NoAccess } from "@/components/settings/no-access";
import { previewTransfer, pendingTransfer } from "@/server/publications/transfer/service";
import { getUi } from "@/server/i18n/locale";
import { TransferForm } from "./transfer-form";

export const dynamic = "force-dynamic";

/**
 * Where a newsletter changes hands.
 *
 * On its own screen rather than behind a menu on the title, because it is the one action here that
 * cannot be undone by the person taking it: afterwards the newsletter is somebody else's, and only
 * they can send it back.
 *
 * The destinations are the workspaces this person already belongs to. That is the whole access
 * rule: you cannot push a newsletter — with its mailing list and its sending reputation — into a
 * workspace you have nothing to do with, and the admin there still has to read you a code.
 */
export default async function TransferPage({ params }: { params: Promise<{ publicationId: string }> }) {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  if (!hasPermission(user, "settings:manage")) return <NoAccess title={tr("Hand it over")} permission="settings:manage" />;
  const { publicationId } = await params;

  const publication = await db.query.publications.findFirst({
    where: and(eq(s.publications.id, publicationId), eq(s.publications.organizationId, tenant.organizationId)),
    columns: { id: true, name: true },
  });
  if (!publication) notFound();

  const [preview, pending, destinations] = await Promise.all([
    previewTransfer(publicationId, tenant.organizationId),
    pendingTransfer(publicationId, tenant.organizationId),
    db
      .select({ id: s.organizations.id, name: s.organizations.name, isPersonal: s.organizations.isPersonal })
      .from(s.organizationMembers)
      .innerJoin(s.organizations, eq(s.organizations.id, s.organizationMembers.organizationId))
      .where(and(eq(s.organizationMembers.userId, user!.id), ne(s.organizationMembers.organizationId, tenant.organizationId), eq(s.organizations.status, "ACTIVE"))),
  ]);

  return (
    <>
      <PageHeader
        title={tr("Hand it over")}
        description={`${publication.name} · ${tr("Move this newsletter to another workspace, with everything that belongs to it.")}`}
        actions={
          <Link href={`/publications/${publicationId}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-brand hover:underline">
            <ArrowLeft className="size-3.5" /> {tr("Back to the newsletter")}
          </Link>
        }
      />
      <PageBody className="mx-auto w-full max-w-2xl">
        <TransferForm
          publicationId={publicationId}
          publicationName={publication.name}
          destinations={destinations}
          preview={{ editions: preview.editions, subscribers: preview.subscribers, contributors: preview.contributors }}
          pending={pending ? { ...pending, expiresAt: pending.expiresAt.toISOString() } : null}
        />
      </PageBody>
    </>
  );
}
