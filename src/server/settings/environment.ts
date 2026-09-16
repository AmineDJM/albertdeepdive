/**
 * Read-only description of the runtime environment for the System settings screen.
 * Only provider *modes* and non-secret configuration are exposed — never keys or URLs with credentials.
 */
import { env } from "@/server/env";

export type EnvironmentInfo = {
  app: { name: string; url: string; nodeEnv: string; logLevel: string };
  ai: { provider: "openai" | "local"; modelFast: string; modelStrong: string; apiKeyConfigured: boolean; customBaseUrl: boolean; monthlyBudgetEur: number };
  email: { provider: "resend" | "log"; effectiveProvider: "resend" | "log"; from: string; apiKeyConfigured: boolean };
  storage: { provider: "local" | "s3"; localDir: string | null; bucket: string | null; region: string | null; customEndpoint: boolean; signedUrlTtlSeconds: number };
  jobs: { runner: "inprocess" | "cli" | "none"; pollIntervalMs: number };
  uploads: { maxFileMb: number; maxFilesPerSubmission: number };
  print: { pageSize: string; chromiumConfigured: boolean };
  automations: { tickTokenConfigured: boolean };
  session: { ttlDays: number };
};

export function describeEnvironment(): EnvironmentInfo {
  return {
    app: { name: env.APP_NAME, url: env.NEXT_PUBLIC_APP_URL, nodeEnv: env.NODE_ENV, logLevel: env.LOG_LEVEL },
    ai: {
      provider: env.AI_PROVIDER,
      modelFast: env.AI_MODEL_FAST,
      modelStrong: env.AI_MODEL_STRONG,
      apiKeyConfigured: Boolean(env.OPENAI_API_KEY),
      customBaseUrl: Boolean(env.OPENAI_BASE_URL),
      monthlyBudgetEur: env.AI_MAX_MONTHLY_BUDGET_EUR,
    },
    email: {
      provider: env.EMAIL_PROVIDER,
      effectiveProvider: env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY ? "resend" : "log",
      from: env.EMAIL_FROM,
      apiKeyConfigured: Boolean(env.RESEND_API_KEY),
    },
    storage: {
      provider: env.STORAGE_PROVIDER,
      localDir: env.STORAGE_PROVIDER === "local" ? env.STORAGE_LOCAL_DIR : null,
      bucket: env.STORAGE_PROVIDER === "s3" ? (env.STORAGE_S3_BUCKET ?? null) : null,
      region: env.STORAGE_PROVIDER === "s3" ? env.STORAGE_S3_REGION : null,
      customEndpoint: Boolean(env.STORAGE_S3_ENDPOINT),
      signedUrlTtlSeconds: env.STORAGE_SIGNED_URL_TTL_SECONDS,
    },
    jobs: { runner: env.JOBS_RUNNER, pollIntervalMs: env.JOBS_POLL_INTERVAL_MS },
    uploads: { maxFileMb: env.UPLOAD_MAX_FILE_MB, maxFilesPerSubmission: env.UPLOAD_MAX_FILES_PER_SUBMISSION },
    print: { pageSize: env.PRINT_PAGE_SIZE, chromiumConfigured: Boolean(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) },
    automations: { tickTokenConfigured: env.AUTOMATION_TICK_TOKEN !== "change-me" },
    session: { ttlDays: env.SESSION_TTL_DAYS },
  };
}
