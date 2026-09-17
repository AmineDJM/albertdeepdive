/**
 * Integrations.
 *
 * Every external service Briefly talks to is configured here, from the interface, by a platform
 * super admin — not from environment variables. Adding Stripe should not mean a redeploy, and the
 * person running Briefly should be able to see at a glance what is connected and what is not.
 *
 * Environment variables still work and still win: a self-hosted install that prefers to inject
 * secrets through its platform keeps doing so, and the console shows those fields as locked rather
 * than pretending they are unset. Anything typed into the interface is encrypted with the same
 * sealed-secret machinery the Gmail connection already uses.
 */

export type IntegrationFieldKind = "text" | "secret" | "url" | "select";

export type IntegrationField = {
  key: string;
  label: string;
  kind: IntegrationFieldKind;
  placeholder?: string;
  help?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  /** When set, this field also reads from the environment, which takes precedence. */
  envVar?: string;
};

export type IntegrationDefinition = {
  key: string;
  name: string;
  category: "payments" | "email" | "ai" | "media" | "storage";
  summary: string;
  /** Where to get the credentials, so nobody has to go hunting. */
  docsUrl?: string;
  docsLabel?: string;
  fields: IntegrationField[];
  /** Which field decides whether this integration counts as configured. */
  primaryField: string;
  /** Set when the integration can be checked against the live service. */
  testable?: boolean;
  /** Shown when the integration is off, so the consequence is obvious. */
  whenMissing: string;
};

export const INTEGRATIONS: IntegrationDefinition[] = [
  {
    key: "stripe",
    name: "Stripe",
    category: "payments",
    summary: "Takes payments for the plans you sell and keeps subscriptions in step.",
    docsUrl: "https://dashboard.stripe.com/apikeys",
    docsLabel: "Stripe dashboard → Developers → API keys",
    primaryField: "secretKey",
    testable: true,
    whenMissing: "Every workspace stays on the free plan and the upgrade buttons say payments are not set up.",
    fields: [
      { key: "secretKey", label: "Secret key", kind: "secret", placeholder: "sk_live_…", required: true, envVar: "STRIPE_SECRET_KEY", help: "Starts with sk_test_ while you are trying it out." },
      { key: "publishableKey", label: "Publishable key", kind: "text", placeholder: "pk_live_…", envVar: "STRIPE_PUBLISHABLE_KEY" },
      {
        key: "webhookSecret",
        label: "Webhook signing secret",
        kind: "secret",
        placeholder: "whsec_…",
        envVar: "STRIPE_WEBHOOK_SECRET",
        help: "From the webhook endpoint you point at /api/webhooks/stripe. Without it, no subscription change reaches Briefly.",
      },
    ],
  },
  {
    key: "brevo",
    name: "Brevo",
    category: "email",
    summary: "Sends your editions and your transactional email at a price that scales with sends, not contacts.",
    docsUrl: "https://app.brevo.com/settings/keys/api",
    docsLabel: "Brevo → SMTP & API → API keys",
    primaryField: "apiKey",
    testable: true,
    whenMissing: "Email is only written to the in-app mailbox, not delivered.",
    fields: [
      { key: "apiKey", label: "API key", kind: "secret", placeholder: "xkeysib-…", required: true, envVar: "BREVO_API_KEY" },
      { key: "from", label: "From address", kind: "text", placeholder: "Briefly <hello@yourdomain.com>", envVar: "EMAIL_FROM", help: "Must be a sender you have verified with Brevo." },
    ],
  },
  {
    key: "resend",
    name: "Resend",
    category: "email",
    summary: "An alternative sender. Brevo is used first when both are configured.",
    docsUrl: "https://resend.com/api-keys",
    docsLabel: "Resend → API keys",
    primaryField: "apiKey",
    testable: true,
    whenMissing: "Nothing — this is only a fallback.",
    fields: [{ key: "apiKey", label: "API key", kind: "secret", placeholder: "re_…", required: true, envVar: "RESEND_API_KEY" }],
  },
  {
    key: "openai",
    name: "OpenAI",
    category: "ai",
    summary: "Reads submissions, clusters them into stories, drafts articles and checks facts.",
    docsUrl: "https://platform.openai.com/api-keys",
    docsLabel: "OpenAI → API keys",
    primaryField: "apiKey",
    testable: true,
    whenMissing: "The newsroom runs on its deterministic local pipeline: clustering and drafting are far weaker.",
    fields: [
      { key: "apiKey", label: "API key", kind: "secret", placeholder: "sk-…", required: true, envVar: "OPENAI_API_KEY" },
      { key: "baseUrl", label: "Base URL", kind: "url", placeholder: "https://api.openai.com/v1", envVar: "OPENAI_BASE_URL", help: "Only for a compatible gateway or a self-hosted model." },
      { key: "modelFast", label: "Fast model", kind: "text", placeholder: "gpt-4o-mini", envVar: "AI_MODEL_FAST" },
      { key: "modelStrong", label: "Strong model", kind: "text", placeholder: "gpt-4o", envVar: "AI_MODEL_STRONG" },
    ],
  },
  {
    key: "higgsfield",
    name: "Higgsfield",
    category: "media",
    summary: "Generates the images and short clips Creative Studio cannot render itself.",
    docsUrl: "https://higgsfield.ai",
    docsLabel: "Higgsfield → API",
    primaryField: "apiKey",
    testable: false,
    whenMissing: "Creative Studio uses only your own media and Briefly's own renderer. Nothing is generated.",
    fields: [
      { key: "apiKey", label: "API key", kind: "secret", placeholder: "hf_…", required: true, envVar: "HIGGSFIELD_API_KEY" },
      { key: "baseUrl", label: "Base URL", kind: "url", placeholder: "https://api.higgsfield.ai", envVar: "HIGGSFIELD_BASE_URL" },
    ],
  },
  {
    key: "storage",
    name: "Object storage",
    category: "storage",
    summary: "Where uploaded photographs, rendered PDFs and generated media live.",
    primaryField: "bucket",
    testable: false,
    whenMissing: "Files are written to local disk, which does not survive a redeploy on most hosts.",
    fields: [
      { key: "bucket", label: "Bucket", kind: "text", placeholder: "briefly-media", envVar: "STORAGE_S3_BUCKET", required: true },
      { key: "region", label: "Region", kind: "text", placeholder: "eu-west-3", envVar: "STORAGE_S3_REGION" },
      { key: "endpoint", label: "Endpoint", kind: "url", placeholder: "https://s3.eu-west-3.amazonaws.com", envVar: "STORAGE_S3_ENDPOINT", help: "For S3-compatible providers such as Cloudflare R2 or Scaleway." },
      { key: "accessKeyId", label: "Access key ID", kind: "text", envVar: "STORAGE_S3_ACCESS_KEY_ID" },
      { key: "secretAccessKey", label: "Secret access key", kind: "secret", envVar: "STORAGE_S3_SECRET_ACCESS_KEY" },
    ],
  },
];

export const CATEGORY_LABELS: Record<IntegrationDefinition["category"], string> = {
  payments: "Payments",
  email: "Email",
  ai: "Intelligence",
  media: "Generated media",
  storage: "Storage",
};

export function integrationByKey(key: string) {
  return INTEGRATIONS.find((i) => i.key === key) ?? null;
}

/** The settings row an integration's values live in. */
export function settingKeyFor(integration: string) {
  return `integration:${integration}`;
}
