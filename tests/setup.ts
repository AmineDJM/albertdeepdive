/* Vitest setup: point every test at the isolated test database and the deterministic providers. */
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5432/albertdeepdive_test";
process.env.AI_PROVIDER = process.env.AI_PROVIDER_TEST ?? "local";

/*
 * Live-model runs only.
 *
 * Node's fetch ignores HTTPS_PROXY, so a suite deliberately pointed at a real provider
 * (AI_PROVIDER_TEST=openai) would go straight out and be refused. Everything else runs against the
 * local provider and never leaves the machine, which is why this is switched on by the same flag
 * rather than by the proxy's presence.
 *
 * The CA bundle has to be on the command line — Node reads NODE_EXTRA_CA_CERTS at startup:
 *   AI_PROVIDER_TEST=openai NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt npx vitest run …
 */
if (process.env.AI_PROVIDER_TEST === "openai" && process.env.HTTPS_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.HTTPS_PROXY));
}
process.env.EMAIL_PROVIDER = "log";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_LOCAL_DIR = "./storage-test";
process.env.JOBS_RUNNER = "none";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-test-secret-test-secret-1234";
process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3100";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/opt/pw-browsers/chromium";
// A known webhook secret so signature verification can be tested. No Stripe key: nothing calls out.
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

export {};
