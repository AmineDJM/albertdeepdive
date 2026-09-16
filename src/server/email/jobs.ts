import { registerJobHandler, JOB_TYPES } from "@/server/jobs/registry";
import { sendEmail, type SendEmailInput } from "./index";

registerJobHandler<{ email: SendEmailInput }, { ok: boolean }>(JOB_TYPES.EMAIL_SEND, async ({ email }) => {
  const result = await sendEmail(email);
  if (!result.ok) throw new Error(result.error);
  return { ok: true };
});
