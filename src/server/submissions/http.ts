/** Shared plumbing for the public contribution route handlers. */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, ForbiddenError } from "@/lib/action-result";
import { env } from "@/server/env";
import { hashIp, hashToken } from "@/server/auth/tokens";
import { createLogger } from "@/server/logger";
import { looksLikeToken } from "@/server/campaigns/tokens";
import { enforceRateLimit, RATE_LIMITS, RateLimitError, type RateLimitRule } from "./rate-limit";
import { fieldErrorsFromIssues } from "@/lib/submissions/schemas";
import type { PublicApiError } from "@/lib/submissions/dto";

const log = createLogger("submissions:http");

export type PublicContext = { token: string; tokenHash: string; ip: string | null; userAgent: string | null };

export function clientMeta(request: Request): { ip: string | null; userAgent: string | null } {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
  return { ip, userAgent: request.headers.get("user-agent") };
}

/** Mutations must come from our own origin when the browser tells us where they come from. */
export function assertPublicOrigin(request: Request) {
  const source = request.headers.get("origin") ?? request.headers.get("referer");
  if (!source) return;
  let host: string;
  try {
    host = new URL(source).host;
  } catch {
    throw new ForbiddenError("Invalid origin");
  }
  const allowed = new Set(
    [new URL(env.NEXT_PUBLIC_APP_URL).host, request.headers.get("host") ?? "", request.headers.get("x-forwarded-host") ?? ""].filter(Boolean),
  );
  if (!allowed.has(host)) throw new ForbiddenError("Cross-origin request rejected");
}

export function errorResponse(err: unknown): NextResponse<PublicApiError> {
  if (err instanceof RateLimitError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } });
  }
  if (err instanceof AppError) {
    return NextResponse.json({ error: err.message, code: err.code, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}) }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json({ error: "Invalid request", code: "VALIDATION", fieldErrors: fieldErrorsFromIssues(err.issues) }, { status: 422 });
  }
  log.error("unhandled public api error", { err });
  return NextResponse.json({ error: "Something went wrong on our side. Please try again.", code: "ERROR" }, { status: 500 });
}

/**
 * Wraps a public handler: validates the token shape, applies origin checks for mutations,
 * rate limits per (token, ip) and converts errors into `{ error, fieldErrors? }` JSON.
 */
export async function publicHandler(
  request: Request,
  params: Promise<{ token: string }>,
  opts: { mutating?: boolean; rule?: RateLimitRule },
  handler: (ctx: PublicContext) => Promise<Response>,
): Promise<Response> {
  try {
    const { token } = await params;
    if (!looksLikeToken(token)) return NextResponse.json({ error: "This link is not valid", code: "INVALID_LINK" }, { status: 404 });
    if (opts.mutating) assertPublicOrigin(request);
    const meta = clientMeta(request);
    const tokenHash = hashToken(token);
    enforceRateLimit(`${tokenHash}:${hashIp(meta.ip) ?? "anon"}`, opts.rule ?? RATE_LIMITS.general);
    return await handler({ token, tokenHash, ...meta });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function readJson<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const body = (await request.json()) as T;
    if (!body || typeof body !== "object") throw new AppError("Expected a JSON object", "BAD_REQUEST", 400);
    return body;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("Expected a JSON body", "BAD_REQUEST", 400);
  }
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new AppError(`Missing ${name}`, "BAD_REQUEST", 400);
  return value;
}
