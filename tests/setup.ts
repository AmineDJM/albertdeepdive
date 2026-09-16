/* Vitest setup: point every test at the isolated test database and the deterministic providers. */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@127.0.0.1:5432/albertdeepdive_test";
process.env.AI_PROVIDER = process.env.AI_PROVIDER_TEST ?? "local";
process.env.EMAIL_PROVIDER = "log";
process.env.STORAGE_PROVIDER = "local";
process.env.STORAGE_LOCAL_DIR = "./storage-test";
process.env.JOBS_RUNNER = "none";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-test-secret-test-secret-1234";
process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3100";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/opt/pw-browsers/chromium";
