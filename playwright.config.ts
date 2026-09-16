import { existsSync, readFileSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Playwright does not read .env, so `pnpm test:e2e` would otherwise miss DATABASE_URL, AUTH_SECRET
// and the browser path that the rest of the project gets from it.
for (const file of [".env.local", ".env"]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = raw.trim().replace(/^["'](.*)["']$/, "$1");
  }
}

// The sandbox ships one Chromium build; prefer it over the version-pinned download.
const chromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: chromium ? { executablePath: chromium } : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: chromium ? undefined : "chromium" } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm exec next dev -p ${port}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
        env: { PORT: String(port), NEXT_PUBLIC_APP_URL: baseURL },
      },
});
