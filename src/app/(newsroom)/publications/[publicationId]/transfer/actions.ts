"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { requirePermission } from "@/server/auth/session";
import { currentOrganizationId } from "@/server/tenancy/context";
import { ok, toActionFailure, ValidationError, type ActionResult } from "@/lib/action-result";
import { cancelTransfer, confirmTransfer, startTransfer } from "@/server/publications/transfer/service";
import { ownerCodeEmail, recipientCodeEmail } from "@/server/publications/transfer/emails";
import { sendEmail } from "@/server/email";
import { getUi } from "@/server/i18n/locale";

/**
 * Handing a newsletter over.
 *
 * `settings:manage` rather than `edition:archive`: giving a publication — its audience included —
 * to another organisation is a decision about the workspace, not about an issue, and the person
 * who can do it should be the person who could also close the account.
 *
 * The codes are generated in the service, sent from here, and never returned to the browser. A
 * screen that could read them would make the second factor a formality.
 */
export async function startTransferAction(publicationId: string, toOrganizationId: string): Promise<ActionResult<{ ownerEmail: string; recipientEmail: string; expiresAt: string }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    const organizationId = await currentOrganizationId();
    if (!user.email) throw new ValidationError("Your account has no email address to send a code to.");

    const started = await startTransfer({
      publicationId,
      fromOrganizationId: organizationId,
      toOrganizationId,
      requestedById: user.id,
      ownerEmail: user.email,
    });

    const [from, to] = await Promise.all([
      db.query.organizations.findFirst({ where: eq(s.organizations.id, organizationId), columns: { name: true } }),
      db.query.organizations.findFirst({ where: eq(s.organizations.id, toOrganizationId), columns: { name: true } }),
    ]);

    const owner = ownerCodeEmail({
      publicationName: started.preview.publicationName,
      toWorkspace: to?.name ?? "another workspace",
      code: started.ownerCode,
      expiresAt: started.expiresAt,
    });
    const recipient = recipientCodeEmail({
      publicationName: started.preview.publicationName,
      fromWorkspace: from?.name ?? "another workspace",
      toWorkspace: to?.name ?? "your workspace",
      code: started.recipientCode,
      expiresAt: started.expiresAt,
      editions: started.preview.editions,
      subscribers: started.preview.subscribers,
    });

    const sent = await Promise.all([
      sendEmail({ to: started.ownerEmail, subject: owner.subject, layout: owner.layout, template: owner.template, entityId: publicationId }),
      sendEmail({ to: started.recipientEmail, subject: recipient.subject, layout: recipient.layout, template: recipient.template, entityId: publicationId }),
    ]);
    // A transfer whose codes never arrived is a screen waiting for something that will not come.
    if (sent.some((result) => !result.ok)) {
      await cancelTransfer(started.transferId, organizationId, user.id);
      throw new ValidationError("The codes could not be sent. Nothing was transferred.");
    }

    revalidatePath(`/publications/${publicationId}`);
    return ok(
      { ownerEmail: started.ownerEmail, recipientEmail: started.recipientEmail, expiresAt: started.expiresAt.toISOString() },
      tr("Two codes are on their way. Nothing moves until both are entered."),
    );
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function confirmTransferAction(transferId: string, ownerCode: string, recipientCode: string): Promise<ActionResult<{ moved: Record<string, number> }>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    const organizationId = await currentOrganizationId();
    const result = await confirmTransfer({ transferId, fromOrganizationId: organizationId, ownerCode, recipientCode, userId: user.id });
    revalidatePath("/publications");
    revalidatePath("/overview");
    return ok(result, tr("The newsletter has moved, with everything that belongs to it."));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function cancelTransferAction(transferId: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    const organizationId = await currentOrganizationId();
    await cancelTransfer(transferId, organizationId, user.id);
    revalidatePath("/publications");
    return ok(null);
  } catch (err) {
    return toActionFailure(err);
  }
}
