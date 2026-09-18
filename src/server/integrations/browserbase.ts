import { chromium, type Browser } from "playwright";
import { integrationConfig } from "./service";
import { createLogger } from "@/server/logger";

const log = createLogger("browserbase");

/**
 * Browserbase: a browser somewhere else.
 *
 * Everything Briefly renders — print pages, Studio frames, the odd contact sheet — is HTML handed
 * to a Chromium, and that HTML carries its own fonts and pictures inline. That is what makes the
 * browser replaceable: one on this machine and one in Browserbase's cloud see exactly the same
 * page, so a host with no room for Chromium can still print. A session lives as long as one render
 * and is closed with it; nothing is kept alive between jobs, because every open minute is billed.
 */

export const BROWSERBASE_API = "https://api.browserbase.com/v1";

export type BrowserbaseConfig = { apiKey: string; projectId?: string; region?: string };

export type BrowserbaseSession = { id: string; connectUrl: string };

/** The key and its options as the console holds them, or null when nothing is configured. */
export async function browserbaseConfig(): Promise<BrowserbaseConfig | null> {
  const config = await integrationConfig("browserbase");
  if (!config.apiKey) return null;
  return { apiKey: config.apiKey, projectId: config.projectId?.trim() || undefined, region: config.region?.trim() || undefined };
}

/**
 * The request Browserbase gets for a new browser.
 *
 * Half an hour of session is far more than a render needs; it is the ceiling for a render that
 * hangs, not the expected length, and the browser is closed the moment the job is done.
 */
export function sessionRequest(config: BrowserbaseConfig, options: { timeoutSeconds?: number } = {}): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = { timeout: options.timeoutSeconds ?? 30 * 60 };
  if (config.projectId) body.projectId = config.projectId;
  if (config.region) body.region = config.region;
  return {
    url: `${BROWSERBASE_API}/sessions`,
    init: {
      method: "POST",
      headers: { "x-bb-api-key": config.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    },
  };
}

export async function createBrowserbaseSession(config: BrowserbaseConfig, options: { timeoutSeconds?: number } = {}): Promise<BrowserbaseSession> {
  const { url, init } = sessionRequest(config, options);
  const res = await fetch(url, init);
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(`Browserbase answered ${res.status} when asked for a browser${detail ? `: ${detail}` : "."}`);
  }
  const session = (await res.json()) as Partial<BrowserbaseSession>;
  if (!session.id || !session.connectUrl) throw new Error("Browserbase returned a session without a connection URL.");
  return { id: session.id, connectUrl: session.connectUrl };
}

/** A browser in Browserbase, connected and ready, or null when the integration is not configured. */
export async function connectBrowserbase(): Promise<Browser | null> {
  const config = await browserbaseConfig();
  if (!config) return null;
  const session = await createBrowserbaseSession(config);
  const browser = await chromium.connectOverCDP(session.connectUrl, { timeout: 30_000 });
  log.info("browser connected", { session: session.id, region: config.region ?? "default" });
  return browser;
}
