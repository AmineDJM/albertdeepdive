import { chromium, type Browser } from "playwright";
import { connectBrowserbase } from "@/server/integrations/browserbase";
import { env } from "@/server/env";
import { createLogger } from "@/server/logger";

const log = createLogger("browser");

/**
 * The one place a Chromium is opened.
 *
 * Printing an edition, shooting a design, reading a customer's website — all of them need a real
 * browser, and all of them should get the same one, chosen the same way: Browserbase when the
 * platform has a key for it, the Chromium on this machine otherwise. Keeping that decision here
 * rather than inside the PDF engine means a caller who only wants to look at a web page does not
 * have to import the printing pipeline to get a browser.
 */

export async function launchBrowser(): Promise<Browser> {
  // A connected Browserbase renders instead of the Chromium on this machine. The page is the same —
  // fonts and pictures travel inside the HTML — so a host too small for a browser still prints.
  // When Browserbase cannot be reached, the local browser is the fallback, not a failed job.
  try {
    const remote = await connectBrowserbase();
    if (remote) return remote;
  } catch (err) {
    log.warn("Browserbase unavailable; using the local browser", { err });
  }
  const executablePath = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  return chromium.launch({
    executablePath,
    args: ["--font-render-hinting=none", "--disable-gpu", "--disable-dev-shm-usage"],
  });
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>, browser?: Browser): Promise<T> {
  if (browser) return fn(browser);
  const own = await launchBrowser();
  try {
    return await fn(own);
  } finally {
    await own.close().catch(() => {});
  }
}
