import { expect, type Page } from "@playwright/test";
import { one } from "./db";

/**
 * Two administrators, deliberately.
 *
 * `ADMIN` runs Albert School: a customer's editor in chief, owner of their workspace, with no view
 * of anyone else's. `PLATFORM_ADMIN` runs Briefly: no workspace of their own, the console as home,
 * and a customer's newsroom only when they open it on purpose. The seed creates both; the journey
 * tests use the first, the console tests the second.
 */
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "briefly-demo";

export const ADMIN = { email: "admin@albertschool.com", password: PASSWORD };
export const PLATFORM_ADMIN = { email: process.env.SEED_ADMIN_EMAIL ?? "admin@briefly.press", password: PASSWORD };

export async function login(page: Page, user = ADMIN) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(overview|editions|admin)/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Standard or Advanced, set straight in the database before signing in.
 *
 * Every person starts in Standard, so a spec that asserts the full control room, the pulse or a
 * tab Standard keeps off the row says so first; a spec about Standard says that too, because one
 * worker runs every spec against the same account and the last choice sticks. The profile page's
 * own switch is exercised by the experience spec, through the interface.
 */
export async function setExperience(mode: "standard" | "advanced", email = ADMIN.email) {
  // The object goes as a parameter the driver serialises itself; a pre-stringified value would
  // arrive as a JSON string and turn the preferences into an array.
  await one(`update users set preferences = coalesce(preferences, '{}'::jsonb) || $1 where email = $2`, [{ experience: mode }, email]);
}

export type PageResponse = {
  status: number;
  headers: Record<string, string>;
  /** The body as base64, so a DOCX, a PDF or a zip survives the trip out of the browser. */
  base64: string;
};

/**
 * A GET the page makes for itself, rather than one made beside it.
 *
 * `page.request` shares the browser's cookie jar but not the browser's rules: it will not attach a
 * `Secure` cookie to an `http://` address, where Chromium makes an exception for 127.0.0.1. The
 * session cookie is Secure in production, so every authenticated API assertion in this suite
 * failed against a production build — signed in on the screen and signed out in the same test's
 * own fetch, one line apart. Asking the page to fetch keeps the browser's rules, and against
 * `next dev` it behaves exactly as before.
 */
export async function getAsPage(page: Page, path: string): Promise<PageResponse> {
  return page.evaluate(async (target) => {
    const res = await fetch(target, { credentials: "include" });
    const bytes = new Uint8Array(await res.arrayBuffer());
    // Chunked: one String.fromCharCode over a whole DOCX overflows the argument stack.
    let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), base64: btoa(binary) };
  }, path);
}

/** The bytes of a response the page fetched. */
export function bodyOf(response: PageResponse): Buffer {
  return Buffer.from(response.base64, "base64");
}

/** The same bytes read as UTF-8 text, byte-order mark and all. */
export function textOf(response: PageResponse): string {
  return bodyOf(response).toString("utf8");
}
