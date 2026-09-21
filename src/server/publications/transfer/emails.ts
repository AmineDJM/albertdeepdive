import type { EmailLayoutInput } from "@/server/email";

/**
 * The two messages a handover sends, and they are deliberately not the same message.
 *
 * The owner's says "somebody asked to move your newsletter" and gives a code — it is as much a
 * warning as an instrument, because if they did not ask, the fact that the mail arrived is how
 * they find out. The recipient's says what is arriving and what comes with it, because an
 * administrator asked for a code with no idea what they are agreeing to receive cannot
 * meaningfully agree.
 */

export type TransferEmail = { subject: string; layout: EmailLayoutInput; template: string };

export const TRANSFER_TEMPLATES = { owner: "transfer_owner_code", recipient: "transfer_recipient_code" } as const;

function minutes(expiresAt: Date, now = new Date()): number {
  return Math.max(1, Math.round((expiresAt.getTime() - now.getTime()) / 60_000));
}

export function ownerCodeEmail(input: { publicationName: string; toWorkspace: string; code: string; expiresAt: Date; now?: Date }): TransferEmail {
  return {
    template: TRANSFER_TEMPLATES.owner,
    subject: `Your code to hand over ${input.publicationName}`,
    layout: {
      preheader: `A transfer of ${input.publicationName} to ${input.toWorkspace} is waiting for two codes.`,
      kicker: input.publicationName,
      title: "Confirm you are handing this newsletter over",
      blocks: [
        { type: "paragraph", text: `Somebody asked to move ${input.publicationName} — with its editions, its readers and its look — to ${input.toWorkspace}.` },
        { type: "kv", rows: [{ label: "Your code", value: input.code }] },
        { type: "paragraph", text: `It is good for ${minutes(input.expiresAt, input.now)} minutes. You will also need the code sent to ${input.toWorkspace}: both are typed on the transfer screen, so neither side can move a newsletter alone.` },
        // The sentence that matters if they did not ask for this.
        { type: "paragraph", text: "If this was not you, do not enter the code. Nothing moves until both codes are entered, and the request expires on its own." },
      ],
      footer: "This code is personal. Briefly will never ask you for it by reply.",
    },
  };
}

export function recipientCodeEmail(input: {
  publicationName: string;
  fromWorkspace: string;
  toWorkspace: string;
  code: string;
  expiresAt: Date;
  editions: number;
  subscribers: number;
  now?: Date;
}): TransferEmail {
  return {
    template: TRANSFER_TEMPLATES.recipient,
    subject: `${input.publicationName} is being handed to ${input.toWorkspace}`,
    layout: {
      preheader: `${input.fromWorkspace} wants to transfer ${input.publicationName} to you.`,
      kicker: input.publicationName,
      title: "A newsletter is being handed to your workspace",
      blocks: [
        { type: "paragraph", text: `${input.fromWorkspace} is transferring ${input.publicationName} to ${input.toWorkspace}. If you accept, it becomes yours to run — and yours to answer for.` },
        // What is arriving, so that agreeing is an informed act rather than a reflex.
        {
          type: "kv",
          rows: [
            { label: "Editions", value: String(input.editions) },
            { label: "Readers", value: String(input.subscribers) },
            { label: "Your code", value: input.code },
          ],
        },
        { type: "paragraph", text: `Read this code out to whoever is making the transfer. It is good for ${minutes(input.expiresAt, input.now)} minutes.` },
        { type: "paragraph", text: "If you were not expecting this, do not share the code. Without it nothing moves." },
      ],
      footer: "This code is personal. Briefly will never ask you for it by reply.",
    },
  };
}
