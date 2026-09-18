import { registerJobHandler, JOB_TYPES } from "@/server/jobs/registry";
import { sendEmail, type SendEmailInput } from "./index";

registerJobHandler<{ email: SendEmailInput }, { ok: boolean }>(JOB_TYPES.EMAIL_SEND, async ({ email }) => {
  const result = await sendEmail(email);
  if (!result.ok) throw new Error(result.error);
  return { ok: true };
});

/** Look at one workspace's sending domain now, rather than at the next scheduled sweep. */
registerJobHandler<{ organizationId: string }, { status: string }>(JOB_TYPES.EMAIL_DOMAIN_VERIFY, async ({ organizationId }) => {
  const { checkSendingDomain } = await import("./domains");
  const row = await checkSendingDomain(organizationId, { force: true });
  return { status: row.status };
});
