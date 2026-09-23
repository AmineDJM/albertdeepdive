"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, requirePermission } from "@/server/auth/session";
import { optionalOrganizationId, requireOrganizationRole } from "@/server/tenancy/context";
import { checkSendingDomain, connectSendingDomain, disconnectSendingDomain, updateSenderIdentity, type ConnectInput, type SenderPatch } from "@/server/email/domains";
import { connectGmail, disconnectGmail, verifyGmail, type GmailStatus } from "@/server/email/gmail";
import { pollInbox, type InboundRunResult } from "@/server/email/inbound";
import { sendEmail } from "@/server/email";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";
import { getUi } from "@/server/i18n/locale";
import { workspaceMasthead } from "@/server/publication/naming";

function revalidateEmail() {
  revalidatePath("/settings/email");
  revalidatePath("/settings/mailbox");
}

export async function connectGmailAction(input: { address: string; displayName: string; password: string; receiveEnabled: boolean }): Promise<ActionResult<GmailStatus>> {
  try {
    const user = await requirePermission("settings:manage");
    const status = await connectGmail(input, user.id);
    revalidateEmail();
    return ok(status, `Connected to ${status.address}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function disconnectGmailAction(): Promise<ActionResult<GmailStatus>> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    const status = await disconnectGmail(user.id);
    revalidateEmail();
    return ok(status, tr("Mailbox disconnected"));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Checks the credentials without saving anything, so a typo is caught before it is stored. */
export async function testGmailAction(input: { address: string; password: string }): Promise<ActionResult<{ ok: boolean }>> {
  const tr = await getUi();
  try {
    await requirePermission("settings:manage");
    const result = await verifyGmail(input);
    if (!result.ok) return { ok: false, error: result.error };
    return ok({ ok: true }, tr("Google accepted the sign-in"));
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Sends a real message to the connected mailbox, so the operator sees it arrive. */
export async function sendTestEmailAction(to: string): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const user = await requirePermission("settings:manage");
    // A workspace-level test, so the workspace masthead is the right name here.
    const masthead = await workspaceMasthead();
    const result = await sendEmail({
      to,
      subject: `${masthead.name} — the newsroom mailbox works`,
      template: "mailbox_test",
      // From the workspace's own sender, so the test shows exactly what a reader would see.
      organizationId: await optionalOrganizationId(),
      layout: {
        preheader: "A test message from the newsroom.",
        kicker: "Mailbox check",
        title: tr("The newsroom mailbox is connected"),
        blocks: [
          { type: "paragraph", text: `${user.name} sent this from ${masthead.name} to check that invitations and reminders will reach contributors.` },
          { type: "paragraph", text: "Reply to this message and your reply appears in the newsroom inbox, ready for triage." },
        ],
      },
    });
    revalidateEmail();
    return result.ok ? ok(null, `Test message sent to ${to}`) : { ok: false, error: result.error ?? "The message could not be sent" };
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function pollInboxAction(): Promise<ActionResult<InboundRunResult>> {
  try {
    await requirePermission("settings:manage");
    const result = await pollInbox();
    revalidateEmail();
    revalidatePath("/inbox");
    const message = result.filed
      ? `${result.filed} repl${result.filed === 1 ? "y" : "ies"} filed in the newsroom inbox`
      : result.polled
        ? `${result.polled} message${result.polled === 1 ? "" : "s"} read, nothing to file`
        : "No new message";
    return ok(result, message);
  } catch (err) {
    return toActionFailure(err);
  }
}

/* ── The customer's own domain ────────────────────────────────────────────────────────────── */

/**
 * Connecting a domain is the workspace's decision, so it is gated on the workspace role rather
 * than on a platform permission: the person who runs Acme connects acme.com, not Briefly staff.
 */
export async function connectDomainAction(input: ConnectInput): Promise<ActionResult<{ status: string; domainName: string }>> {
  const tr = await getUi();
  try {
    const tenant = await requireOrganizationRole("ADMIN");
    const user = await getCurrentUser();
    const row = await connectSendingDomain(tenant.organizationId, input, user?.id ?? null);
    revalidatePath("/settings/email");
    return ok({ status: row.status, domainName: row.domainName }, `${row.domainName} ${tr("is registered. Add the records below and Briefly will take it from there.")}`);
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function checkDomainAction(): Promise<ActionResult<{ status: string }>> {
  const tr = await getUi();
  try {
    const tenant = await requireOrganizationRole("ADMIN");
    const row = await checkSendingDomain(tenant.organizationId, { force: true });
    revalidatePath("/settings/email");
    return ok({ status: row.status }, row.status === "READY" ? tr("Ready to send") : tr("Checked. We keep checking automatically."));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function updateSenderAction(patch: SenderPatch): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const tenant = await requireOrganizationRole("ADMIN");
    const user = await getCurrentUser();
    await updateSenderIdentity(tenant.organizationId, patch, user?.id ?? null);
    revalidatePath("/settings/email");
    revalidatePath("/settings");
    return ok(null, tr("Sender saved"));
  } catch (err) {
    return toActionFailure(err);
  }
}

export async function disconnectDomainAction(): Promise<ActionResult> {
  const tr = await getUi();
  try {
    const tenant = await requireOrganizationRole("ADMIN");
    const user = await getCurrentUser();
    await disconnectSendingDomain(tenant.organizationId, user?.id ?? null);
    revalidatePath("/settings/email");
    return ok(null, tr("Domain removed. Your editions go out from Briefly's sending address again, still under your name."));
  } catch (err) {
    return toActionFailure(err);
  }
}
