"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/server/auth/session";
import { connectGmail, disconnectGmail, verifyGmail, type GmailStatus } from "@/server/email/gmail";
import { pollInbox, type InboundRunResult } from "@/server/email/inbound";
import { sendEmail } from "@/server/email";
import { ok, toActionFailure, type ActionResult } from "@/lib/action-result";

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
  try {
    const user = await requirePermission("settings:manage");
    const status = await disconnectGmail(user.id);
    revalidateEmail();
    return ok(status, "Mailbox disconnected");
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Checks the credentials without saving anything, so a typo is caught before it is stored. */
export async function testGmailAction(input: { address: string; password: string }): Promise<ActionResult<{ ok: boolean }>> {
  try {
    await requirePermission("settings:manage");
    const result = await verifyGmail(input);
    if (!result.ok) return { ok: false, error: result.error };
    return ok({ ok: true }, "Google accepted the sign-in");
  } catch (err) {
    return toActionFailure(err);
  }
}

/** Sends a real message to the connected mailbox, so the operator sees it arrive. */
export async function sendTestEmailAction(to: string): Promise<ActionResult> {
  try {
    const user = await requirePermission("settings:manage");
    const result = await sendEmail({
      to,
      subject: "Albert's Deep Dive — the newsroom mailbox works",
      template: "mailbox_test",
      layout: {
        preheader: "A test message from the newsroom.",
        kicker: "Mailbox check",
        title: "The newsroom mailbox is connected",
        blocks: [
          { type: "paragraph", text: `${user.name} sent this from Albert's Deep Dive to check that invitations and reminders will reach contributors.` },
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
