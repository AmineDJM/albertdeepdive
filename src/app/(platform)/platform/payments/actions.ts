"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { retryInvoicePayment, sendPaymentReminder, syncSubscriptionFromStripe } from "@/server/platform/payments";
import { BRAND } from "@/lib/brand";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

/**
 * What the payments screen does about money: all of it platform work, gated on `settings:manage`.
 */

function refresh(organizationId?: string | null) {
  revalidatePath("/platform/payments");
  if (organizationId) revalidatePath(`/platform/workspaces/${organizationId}`);
}

export async function retryInvoiceAction(invoiceId: string): Promise<ActionResult<{ status: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    const invoice = await retryInvoicePayment(invoiceId, user.id);
    refresh(invoice.workspace?.id);
    return ok({ status: invoice.status }, invoice.status === "paid" ? tr("Paid. The card went through.") : tr("The charge was attempted; Stripe will report how it went."));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function remindInvoiceAction(invoiceId: string): Promise<ActionResult<{ sentTo: number }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    const result = await sendPaymentReminder(invoiceId, { actorId: user.id, appName: BRAND.name });
    refresh(result.invoice.workspace?.id);
    return ok({ sentTo: result.sentTo.length }, result.sentTo.length === 1 ? tr("Reminder sent to one person.") : `${tr("Reminder sent to")} ${result.sentTo.length} ${tr("people.")}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function syncSubscriptionAction(organizationId: string): Promise<ActionResult<{ status: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    const subscription = await syncSubscriptionFromStripe(organizationId, user.id);
    refresh(organizationId);
    return ok({ status: subscription.status }, tr("Refreshed from Stripe"));
  } catch (err) {
    return toActionFailure(err);
  }
}
