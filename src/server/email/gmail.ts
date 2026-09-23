import { z } from "zod";
import { createLogger } from "@/server/logger";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import { deleteSecretSetting, maskSecret, open, readSecretSetting, seal, writeSecretSetting, type SealedSecret } from "@/server/settings/secrets";
import { ValidationError } from "@/lib/action-result";

const log = createLogger("email:gmail");

export const GMAIL_SETTING_KEY = "email.gmail";

/**
 * A Gmail mailbox connected from the interface.
 *
 * Google blocks a plain account password, so the operator creates an **app password** once
 * (Google Account → Security → 2-Step Verification → App passwords) and pastes it here. That is
 * the whole setup: no Google Cloud project, no OAuth consent screen, no third-party email
 * provider. The password is encrypted before it touches the database.
 */
export type GmailConnection = {
  address: string;
  displayName: string;
  /** How the mailbox authenticates. Older connections without this field are app passwords. */
  mode?: "password" | "oauth";
  /** Set for the app-password mode. */
  password?: SealedSecret;
  /** Set for the "Sign in with Google" mode: the long-lived Google refresh token, sealed. */
  refreshToken?: SealedSecret;
  /** Newsroom replies land here; leave empty to receive nothing. */
  receiveEnabled: boolean;
  connectedAt: string;
  lastVerifiedAt: string | null;
  lastPolledAt: string | null;
  lastUid: number | null;
};

export function connectionMode(c: GmailConnection): "password" | "oauth" {
  return c.mode ?? (c.refreshToken ? "oauth" : "password");
}

export type GmailStatus = {
  connected: boolean;
  mode: "password" | "oauth" | null;
  address: string | null;
  displayName: string | null;
  passwordHint: string | null;
  receiveEnabled: boolean;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastPolledAt: string | null;
};

export const gmailInputSchema = z.object({
  address: z.string().trim().toLowerCase().email("That is not a valid email address"),
  displayName: z.string().trim().min(1, "A sender name is required").max(80),
  password: z.string().trim().min(1, "The app password is required"),
  receiveEnabled: z.boolean().default(true),
});
export type GmailInput = z.infer<typeof gmailInputSchema>;

/**
 * Timeouts matter here: a network that blocks outbound SMTP does not refuse the connection, it
 * swallows it. Without these an operator watches a spinner instead of reading what went wrong.
 */
const CONNECT_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 30_000;

const SMTP = {
  host: "smtp.gmail.com",
  port: 465,
  secure: true,
  connectionTimeout: CONNECT_TIMEOUT_MS,
  greetingTimeout: CONNECT_TIMEOUT_MS,
  socketTimeout: SOCKET_TIMEOUT_MS,
};
const IMAP = {
  host: "imap.gmail.com",
  port: 993,
  secure: true,
  greetingTimeout: CONNECT_TIMEOUT_MS,
  socketTimeout: SOCKET_TIMEOUT_MS,
  connectionTimeout: CONNECT_TIMEOUT_MS,
};

/** Fails loudly rather than hanging, whatever the mail library decides to do. */
async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Google prints app passwords in groups of four; people paste them with the spaces. */
function normalisePassword(value: string) {
  return value.replace(/\s+/g, "");
}

export async function getGmailConnection(): Promise<GmailConnection | null> {
  return readSecretSetting<GmailConnection>(GMAIL_SETTING_KEY);
}

export async function gmailStatus(): Promise<GmailStatus> {
  const c = await getGmailConnection();
  if (!c) {
    return { connected: false, mode: null, address: null, displayName: null, passwordHint: null, receiveEnabled: false, connectedAt: null, lastVerifiedAt: null, lastPolledAt: null };
  }
  return {
    connected: true,
    mode: connectionMode(c),
    address: c.address,
    displayName: c.displayName,
    passwordHint: connectionMode(c) === "password" ? maskSecret(open(c.password)) : null,
    receiveEnabled: c.receiveEnabled,
    connectedAt: c.connectedAt,
    lastVerifiedAt: c.lastVerifiedAt,
    lastPolledAt: c.lastPolledAt,
  };
}

/**
 * Stores a mailbox connected through "Sign in with Google". We keep only the refresh token
 * (sealed); access tokens are short-lived and fetched from it when a message is sent or read.
 */
export async function connectGmailOAuth(input: { address: string; refreshToken: string; displayName?: string }, userId?: string | null): Promise<GmailStatus> {
  const existing = await getGmailConnection();
  const now = new Date().toISOString();
  const connection: GmailConnection = {
    address: input.address.toLowerCase(),
    displayName: input.displayName || existing?.displayName || input.address,
    mode: "oauth",
    refreshToken: seal(input.refreshToken),
    receiveEnabled: existing?.address === input.address ? existing.receiveEnabled : true,
    connectedAt: existing?.address === input.address ? existing.connectedAt : now,
    lastVerifiedAt: now,
    lastPolledAt: existing?.address === input.address ? (existing.lastPolledAt ?? null) : null,
    lastUid: existing?.address === input.address ? (existing.lastUid ?? null) : null,
  };
  await writeSecretSetting(GMAIL_SETTING_KEY, connection, "Gmail mailbox used to send and receive newsroom email");
  await audit({ action: "email.gmail.connect", userId, entityType: "SETTING", metadata: { address: input.address, mode: "oauth" } });
  log.info("gmail connected via oauth", { address: input.address });
  return gmailStatus();
}

function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/Invalid login|Username and Password not accepted|AUTHENTICATIONFAILED/i.test(message)) {
    return "Google refused the sign-in. Use a 16-character app password (not your Google password), and check the address is right.";
  }
  if (/Application-specific password required/i.test(message)) {
    return "Google wants an app password. Turn on 2-Step Verification, then create one under App passwords.";
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|timed? ?out|Connection timeout|Greeting never received/i.test(message)) {
    return "Could not reach Gmail. The server needs outbound access to smtp.gmail.com on port 465 and imap.gmail.com on port 993.";
  }
  return message;
}

/** Signs in to Gmail to prove the credentials work before anything is saved. */
export async function verifyGmail(input: { address: string; password: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({
    ...SMTP,
    auth: { user: input.address, pass: normalisePassword(input.password) },
  });
  try {
    await withTimeout(transport.verify(), CONNECT_TIMEOUT_MS + 5_000, "The sign-in to Gmail");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  } finally {
    transport.close();
  }
}

export async function connectGmail(rawInput: z.input<typeof gmailInputSchema>, userId?: string | null): Promise<GmailStatus> {
  const parsed = gmailInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError("Check the Gmail details", Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), [i.message]])));
  }
  const input = parsed.data;
  const password = normalisePassword(input.password);

  const check = await verifyGmail({ address: input.address, password });
  if (!check.ok) throw new ValidationError(check.error, { password: [check.error] });

  const existing = await getGmailConnection();
  const now = new Date().toISOString();
  const connection: GmailConnection = {
    address: input.address,
    displayName: input.displayName,
    password: seal(password),
    receiveEnabled: input.receiveEnabled,
    connectedAt: existing?.address === input.address ? (existing.connectedAt ?? now) : now,
    lastVerifiedAt: now,
    lastPolledAt: existing?.address === input.address ? (existing.lastPolledAt ?? null) : null,
    lastUid: existing?.address === input.address ? (existing.lastUid ?? null) : null,
  };
  await writeSecretSetting(GMAIL_SETTING_KEY, connection, "Gmail mailbox used to send and receive newsroom email", userId);
  await audit({ action: "email.gmail.connect", userId, entityType: "SETTING", metadata: { address: input.address, receiveEnabled: input.receiveEnabled } });
  log.info("gmail connected", { address: input.address });
  return gmailStatus();
}

export async function disconnectGmail(userId?: string | null) {
  const existing = await getGmailConnection();
  await deleteSecretSetting(GMAIL_SETTING_KEY);
  await audit({ action: "email.gmail.disconnect", userId, entityType: "SETTING", metadata: { address: existing?.address ?? null } });
  return gmailStatus();
}

async function touch(patch: Partial<GmailConnection>) {
  const current = await getGmailConnection();
  if (!current) return;
  await writeSecretSetting(GMAIL_SETTING_KEY, { ...current, ...patch }, "Gmail mailbox used to send and receive newsroom email");
}

/**
 * SMTP credentials for the connected mailbox. App-password mode passes the password; OAuth mode
 * hands nodemailer the client + refresh token so it fetches and refreshes access tokens itself.
 */
async function smtpAuth(connection: GmailConnection) {
  if (connectionMode(connection) === "oauth") {
    const refreshToken = open(connection.refreshToken);
    if (!refreshToken) throw new ValidationError("The Google connection expired. Reconnect the mailbox in Settings → Email.");
    return {
      type: "OAuth2" as const,
      user: connection.address,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      refreshToken,
    };
  }
  const password = open(connection.password);
  if (!password) throw new ValidationError("The stored Gmail password could not be read. Connect the mailbox again in Settings → Email.");
  return { user: connection.address, pass: password };
}

/** IMAP credentials: app password, or a fresh Google access token derived from the refresh token. */
async function imapAuth(connection: GmailConnection): Promise<{ user: string; pass: string } | { user: string; accessToken: string } | null> {
  if (connectionMode(connection) === "oauth") {
    const refreshToken = open(connection.refreshToken);
    if (!refreshToken) return null;
    const { refreshAccessToken } = await import("./google-oauth");
    const { accessToken } = await refreshAccessToken(refreshToken);
    return { user: connection.address, accessToken };
  }
  const password = open(connection.password);
  if (!password) return null;
  return { user: connection.address, pass: password };
}

/** `fromName` is the name on the envelope; the address is always the mailbox's own. */
export type GmailSendInput = { to: string; subject: string; html: string; text?: string; cc?: string; replyTo?: string; fromName?: string; headers?: Record<string, string> };

/** Sends through the connected mailbox. Replies go to the same address, which is the point. */
export async function sendThroughGmail(message: GmailSendInput): Promise<{ providerMessageId?: string }> {
  const connection = await getGmailConnection();
  if (!connection) throw new ValidationError("No Gmail mailbox is connected. Connect one in Settings → Email.");

  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport({ ...SMTP, auth: await smtpAuth(connection) });
  try {
    const info = await withTimeout(
      transport.sendMail({
        from: { name: message.fromName || connection.displayName, address: connection.address },
        to: message.to,
        cc: message.cc,
        replyTo: message.replyTo ?? connection.address,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: message.headers,
      }),
      SOCKET_TIMEOUT_MS + 5_000,
      "Sending through Gmail",
    );
    await touch({ lastVerifiedAt: new Date().toISOString() });
    return { providerMessageId: info.messageId };
  } catch (err) {
    throw new Error(friendlyError(err));
  } finally {
    transport.close();
  }
}

export type IncomingMessage = {
  uid: number;
  from: string;
  fromName: string | null;
  subject: string;
  text: string;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  receivedAt: Date;
  attachments: { filename: string; contentType: string; content: Buffer }[];
};

/**
 * Reads messages that arrived since the last poll. Gmail keeps a monotonic UID per mailbox, so
 * remembering the last one we read is enough to never process a reply twice.
 */
export async function fetchNewGmailMessages(options: { limit?: number } = {}): Promise<IncomingMessage[]> {
  const connection = await getGmailConnection();
  if (!connection || !connection.receiveEnabled) return [];
  const auth = await imapAuth(connection);
  if (!auth) return [];

  const { ImapFlow } = await import("imapflow");
  const { simpleParser } = await import("mailparser");
  const client = new ImapFlow({ ...IMAP, auth, logger: false });
  const messages: IncomingMessage[] = [];
  let highestUid = connection.lastUid ?? 0;

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS + 5_000, "The connection to the Gmail inbox");
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      if (!mailbox || typeof mailbox === "boolean") return [];
      // First connection: start from now rather than importing years of history.
      if (!connection.lastUid) {
        highestUid = Math.max(0, (mailbox.uidNext ?? 1) - 1);
        await touch({ lastUid: highestUid, lastPolledAt: new Date().toISOString() });
        return [];
      }
      const range = `${connection.lastUid + 1}:*`;
      const limit = options.limit ?? 40;
      for await (const item of client.fetch(range, { uid: true, source: true }, { uid: true })) {
        if (item.uid <= connection.lastUid) continue;
        highestUid = Math.max(highestUid, item.uid);
        if (messages.length >= limit) continue;
        const parsed = await simpleParser(item.source as Buffer);
        const from = parsed.from?.value?.[0];
        if (!from?.address) continue;
        messages.push({
          uid: item.uid,
          from: from.address.toLowerCase(),
          fromName: from.name || null,
          subject: parsed.subject ?? "(no subject)",
          text: (parsed.text ?? "").trim(),
          html: typeof parsed.html === "string" ? parsed.html : null,
          messageId: parsed.messageId ?? null,
          inReplyTo: parsed.inReplyTo ?? null,
          receivedAt: parsed.date ?? new Date(),
          attachments: (parsed.attachments ?? [])
            .filter((a) => a.content && a.filename)
            .map((a) => ({ filename: a.filename as string, contentType: a.contentType, content: a.content as Buffer })),
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  await touch({ lastUid: highestUid, lastPolledAt: new Date().toISOString() });
  return messages;
}
