import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { createLogger } from "@/server/logger";
import { runAutomationTick } from "@/server/campaigns/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("api:automations");

function tokenMatches(given: string | null | undefined) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(env.AUTOMATION_TICK_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorised(request: Request) {
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
  const query = new URL(request.url).searchParams.get("token");
  return tokenMatches(bearer) || tokenMatches(query);
}

/**
 * POST /api/automations/tick — runs one scheduler pass. Meant for an external cron
 * (Trigger.dev, GitHub Actions, Vercel Cron…): `Authorization: Bearer $AUTOMATION_TICK_TOKEN`
 * or `?token=`. GET is accepted for cron providers that cannot POST.
 */
async function handle(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const nowParam = url.searchParams.get("now");
  const now = nowParam && env.NODE_ENV !== "production" ? new Date(nowParam) : undefined;
  if (now && Number.isNaN(now.getTime())) return NextResponse.json({ error: "Invalid now" }, { status: 400 });
  try {
    const result = await runAutomationTick({ triggeredBy: "SCHEDULER", now });
    return NextResponse.json({ ok: result.errors.length === 0, ...result });
  } catch (err) {
    log.error("tick failed", { err });
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Tick failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
