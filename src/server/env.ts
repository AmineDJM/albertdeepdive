import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("Albert Deep Dive"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().min(1).default("postgres://postgres@127.0.0.1:5432/albertdeepdive"),
  DATABASE_URL_TEST: z.string().optional(),
  AUTH_SECRET: z.string().min(16).default("development-only-secret-change-me-please"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@albertschool.com"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("albert-deep-dive"),
  AI_PROVIDER: z.enum(["openai", "local"]).default("local"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  AI_MODEL_FAST: z.string().default("gpt-4.1-mini"),
  AI_MODEL_STRONG: z.string().default("gpt-4.1"),
  AI_MAX_MONTHLY_BUDGET_EUR: z.coerce.number().default(50),
  AI_PRICING: z.string().default("gpt-4.1-mini:0.37:1.48;gpt-4.1:1.85:7.40;gpt-4o-mini:0.14:0.55;gpt-4o:2.30:9.20;gpt-5-mini:0.23:1.85;gpt-5:1.15:9.20"),
  EMAIL_PROVIDER: z.enum(["resend", "log"]).default("log"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Albert Deep Dive <newsroom@albertschool.com>"),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().default("auto"),
  STORAGE_S3_ENDPOINT: z.string().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_PUBLIC_BASE_URL: z.string().optional(),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().default(900),
  UPLOAD_MAX_FILE_MB: z.coerce.number().default(25),
  UPLOAD_MAX_FILES_PER_SUBMISSION: z.coerce.number().default(20),
  JOBS_RUNNER: z.enum(["inprocess", "cli", "none"]).default("inprocess"),
  JOBS_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  PLAYWRIGHT_CHROMIUM_EXECUTABLE: z.string().optional(),
  PRINT_PAGE_SIZE: z.enum(["A4", "TABLOID", "LETTER"]).default("A4"),
  AUTOMATION_TICK_TOKEN: z.string().default("change-me"),
});

function loadEnv() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const value = parsed.data;
  if (value.NODE_ENV === "test" && value.DATABASE_URL_TEST) {
    value.DATABASE_URL = value.DATABASE_URL_TEST;
  }
  return value;
}

export const env = loadEnv();
export type Env = typeof env;

export function isProduction() {
  return env.NODE_ENV === "production";
}
