import Link from "next/link";
import { ArrowUpRight, Wallet } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { requireTenant } from "@/server/tenancy/context";
import { listPublications } from "@/server/outputs/service";
import { payingReadersByTitle, readerPaymentsFor } from "@/server/payments/readers";
import { PageBody, PageHeader, SectionTitle } from "@/components/newsroom/page-header";
import { Button } from "@/components/ui/button";
import { describePrice } from "@/lib/payments";
import { PaymentsConnection } from "./payments-connection";
import { getUi } from "@/server/i18n/locale";

export const dynamic = "force-dynamic";

/**
 * Reader payments belong to the workspace, not to the platform: its Stripe account, its money.
 * So the page is for the workspace's owners and administrators, whatever their role in Briefly.
 */
export default async function ReaderPaymentsPage() {
  const tr = await getUi();
  const [user, tenant] = await Promise.all([getCurrentUser(), requireTenant()]);
  const canManage = tenant.role === "OWNER" || tenant.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  if (!canManage) {
    return (
      <>
        <PageHeader title={tr("Reader payments")} />
        <PageBody>
          <p className="text-[14px] text-muted-foreground">{tr("Only the owners and administrators of this workspace can connect its payment account.")}</p>
        </PageBody>
      </>
    );
  }

  const [status, publications, paying] = await Promise.all([readerPaymentsFor(tenant.organizationId), listPublications(tenant.organizationId), payingReadersByTitle(tenant.organizationId)]);
  const paid = publications.filter((publication) => publication.access === "paid");

  return (
    <>
      <PageHeader
        title={tr("Reader payments")}
        description={tr("Charge for a title on your own Stripe account. The money goes to you; Briefly never holds it.")}
        actions={
          <Button size="sm" variant="outline" asChild>
            <Link href="/publications">
              {tr("Publications")}{" "}<ArrowUpRight />
            </Link>
          </Button>
        }
      />
      <PageBody className="space-y-5">
        <section>
          <SectionTitle>{tr("Stripe account")}</SectionTitle>
          <PaymentsConnection status={status} />
        </section>

        <section>
          <SectionTitle>{tr("Paid titles")}</SectionTitle>
          {paid.length ? (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {paid.map((publication) => (
                <li key={publication.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                  <Wallet className="size-3.5 text-muted-foreground" />
                  <span className="min-w-0 flex-1 font-medium">{publication.name}</span>
                  <span className="text-xs text-muted-foreground">{publication.priceCents ? describePrice(publication.priceCents, publication.priceCurrency, publication.priceInterval) : "—"}</span>
                  <span className="tabular text-xs">{paying.get(publication.id) ?? 0}{" "}{tr("paying")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              {status ? "No paid title yet. Set a title to Paid from Publications." : "Connect your Stripe account, then set a title to Paid from Publications."}
            </p>
          )}
        </section>

        <p className="text-2xs leading-relaxed text-muted-foreground">
          {tr("How it works: a reader who subscribes to a paid title pays on the Stripe checkout page, against your account, and is subscribed the moment the payment goes through. Leaving is still one click from any email; their subscription is then cancelled at the end of what they paid for, so nothing further is charged and nothing has to be refunded. Every hour Briefly asks Stripe about subscriptions reaching the end of their period, and stops the mail for any that did not renew. Your key is encrypted with the application secret before it is written to the database and is never shown again.")}</p>
      </PageBody>
    </>
  );
}
