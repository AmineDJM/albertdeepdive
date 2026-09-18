"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { requireOrganizationRole } from "@/server/tenancy/context";
import { connectReaderPayments, disconnectReaderPayments, type ReaderPaymentsStatus } from "@/server/payments/readers";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";

/** The workspace's own money, so the workspace's own administrators — not the platform's. */
export async function connectReaderPaymentsAction(secretKey: string): Promise<ActionResult<ReaderPaymentsStatus>> {
  try {
    const user = await requireUser();
    const tenant = await requireOrganizationRole("ADMIN");
    const status = await connectReaderPayments(tenant.organizationId, secretKey, user.id);
    revalidatePath("/settings/payments");
    revalidatePath("/publications");
    return ok(status, `Connected to ${status.accountName ?? "your Stripe account"}${status.livemode ? "" : " (test mode)"}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function disconnectReaderPaymentsAction(): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requireUser();
    const tenant = await requireOrganizationRole("ADMIN");
    await disconnectReaderPayments(tenant.organizationId, user.id);
    revalidatePath("/settings/payments");
    revalidatePath("/publications");
    return ok(null, tr("Stripe disconnected"));
  } catch (err) {
    return toActionFailure(err);
  }
}
