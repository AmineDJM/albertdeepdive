"use server";

import { answerInformationRequest, type AnswerFile } from "@/server/editorial/information-requests";
import { env } from "@/server/env";
import { toActionFailure } from "@/lib/action-result";

export type RespondState = { status: "idle" | "success" | "error"; message?: string; answered?: number; attachments?: number };

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 6;

function rateLimited(token: string): boolean {
  const now = Date.now();
  const entry = attempts.get(token);
  if (!entry || entry.resetAt < now) {
    attempts.set(token, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

/** Server action bound to the request token: records the contributor's answers and optional photos. */
export async function submitAnswers(token: string, _prev: RespondState, formData: FormData): Promise<RespondState> {
  if (!token || rateLimited(token)) return { status: "error", message: "Too many attempts. Please try again in a few minutes." };
  const answers: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("answer:") && typeof value === "string") answers[key.slice("answer:".length)] = value.slice(0, 5000);
  }
  const freeTextRaw = formData.get("freeText");
  const freeText = typeof freeTextRaw === "string" ? freeTextRaw.slice(0, 10000) : null;
  const maxBytes = env.UPLOAD_MAX_FILE_MB * 1024 * 1024;
  const files: AnswerFile[] = [];
  for (const entry of formData.getAll("files")) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    if (files.length >= env.UPLOAD_MAX_FILES_PER_SUBMISSION) break;
    if (entry.size > maxBytes) return { status: "error", message: `“${entry.name}” is larger than ${env.UPLOAD_MAX_FILE_MB} MB.` };
    if (!entry.type.startsWith("image/")) return { status: "error", message: `“${entry.name}” is not an image.` };
    files.push({ buffer: Buffer.from(await entry.arrayBuffer()), fileName: entry.name, mimeType: entry.type });
  }
  try {
    const result = await answerInformationRequest(token, { answers, freeText, files });
    return { status: "success", answered: result.answeredKeys.length, attachments: result.attachments };
  } catch (err) {
    return { status: "error", message: toActionFailure(err).error };
  }
}
