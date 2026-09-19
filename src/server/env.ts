import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  APP_NAME: z.string().default("Briefly"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DATABASE_URL: z.string().min(1).default("postgres://postgres@127.0.0.1:5432/albertdeepdive"),
  DATABASE_URL_TEST: z.string().optional(),
  AUTH_SECRET: z.string().min(16).default("development-only-secret-change-me-please"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SEED_ADMIN_EMAIL: z.string().email().default("admin@briefly.press"),
  SEED_ADMIN_PASSWORD: z.string().min(8).default("albert-deep-dive"),
  AI_PROVIDER: z.enum(["openai", "local"]).default("local"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  AI_MODEL_FAST: z.string().default("gpt-4.1-mini"),
  AI_MODEL_STRONG: z.string().default("gpt-4.1"),
  AI_MAX_MONTHLY_BUDGET_EUR: z.coerce.number().default(50),
  AI_PRICING: z.string().default("gpt-4.1-mini:0.37:1.48;gpt-4.1:1.85:7.40;gpt-4o-mini:0.14:0.55;gpt-4o:2.30:9.20;gpt-5-mini:0.23:1.85;gpt-5:1.15:9.20"),
  EMAIL_PROVIDER: z.enum(["brevo", "resend", "log"]).default("log"),
  RESEND_API_KEY: z.string().optional(),
  // Brevo is the default provider for Briefly: its free tier covers a small newsletter and its
  // paid tiers are priced per email rather than per contact, which suits monthly publishing.
  BREVO_API_KEY: z.string().optional(),
  // Billing is optional: with no keys, every workspace is on the free plan and nothing breaks.
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Briefly <newsroom@briefly.press>"),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  STORAGE_S3_BUCKET: z.string().optional(),
  STORAGE_S3_REGION: z.string().default("auto"),
  STORAGE_S3_ENDPOINT: z.string().optional(),
  STORAGE_S3_ACCESS_KEY_ID: z.string().optional(),
  STORAGE_S3_SECRET_ACCESS_KEY: z.string().optional(),
  STORAGE_S3_PUBLIC_BASE_URL: z.string().optional(),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().default(900),
  /*
   * Let production write durable customer files to the local disk.
   *
   * Off by default, because the default is the trap: an install with no bucket connected accepts
   * every upload and loses them on the next container replacement. Set this only where the disk is
   * a volume you trust — and the end-to-end suite sets it, because it runs a production build
   * against a scratch directory on purpose.
   */
  STORAGE_ALLOW_LOCAL_DURABLE: z.coerce.boolean().default(false),
  UPLOAD_MAX_FILE_MB: z.coerce.number().default(25),
  UPLOAD_MAX_FILES_PER_SUBMISSION: z.coerce.number().default(20),
  JOBS_RUNNER: z.enum(["inprocess", "cli", "none"]).default("inprocess"),
  JOBS_POLL_INTERVAL_MS: z.coerce.number().default(2000),
  PLAYWRIGHT_CHROMIUM_EXECUTABLE: z.string().optional(),
  PRINT_PAGE_SIZE: z.enum(["A4", "TABLOID", "LETTER"]).default("A4"),
  AUTOMATION_TICK_TOKEN: z.string().default("change-me"),
  // Optional. When both are set, "Sign in with Google" appears on Settings → Email and the mailbox
  // connects with one click. Without them, the app-password method is used instead.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
});

/**
 * The address the newsroom hands out — in contribution links, signed storage URLs and emails.
 *
 * A hosting platform only knows a service's public URL once it exists, which is too late for a
 * blueprint to set it. Render, Railway, Fly and Vercel all publish it to the running process
 * instead, so the environment variable stays optional and this fills it in.
 */
export function publicAppUrl(source: Record<string, string | undefined>): string | undefined {
  const explicit = source.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit;
  const platform = source.RENDER_EXTERNAL_URL || source.RAILWAY_PUBLIC_DOMAIN || source.FLY_APP_NAME || source.VERCEL_URL;
  if (!platform) return undefined;
  const value = platform.trim();
  if (/^https?:\/\//.test(value)) return value;
  return `https://${source.FLY_APP_NAME ? `${value}.fly.dev` : value}`;
}

function loadEnv() {
  const parsed = schema.safeParse({ ...process.env, NEXT_PUBLIC_APP_URL: publicAppUrl(process.env) });
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
