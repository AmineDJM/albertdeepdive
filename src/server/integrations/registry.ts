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
  category: "payments" | "email" | "ai" | "media" | "rendering" | "storage";
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
    key: "resend",
    name: "Resend",
    category: "email",
    summary: "Delivers every email Briefly sends — editions, invitations, receipts — and lets each customer send from their own domain.",
    docsUrl: "https://resend.com/api-keys",
    docsLabel: "Resend → API keys",
    primaryField: "apiKey",
    testable: true,
    whenMissing: "Email goes through the connected mailbox or Brevo instead, and customers cannot connect their own domain.",
    fields: [
      { key: "apiKey", label: "API key", kind: "secret", placeholder: "re_…", required: true, envVar: "RESEND_API_KEY" },
      { key: "sharedDomain", label: "Briefly sending domain", kind: "text", placeholder: "send.briefly.press", envVar: "EMAIL_SHARED_DOMAIN", help: "A domain of Briefly's, verified in Resend, that customers send from until their own is ready. “Set up delivery” registers it if needed." },
      { key: "region", label: "Region", kind: "text", placeholder: "eu-west-1", envVar: "RESEND_REGION", help: "Where customer domains are created: eu-west-1, us-east-1, sa-east-1 or ap-northeast-1." },
      { key: "webhookSecret", label: "Webhook signing secret", kind: "secret", placeholder: "whsec_…", envVar: "RESEND_WEBHOOK_SECRET", help: "Filled in by “Set up delivery”, which creates the webhook for /api/webhooks/resend." },
      { key: "domainConnectProviderId", label: "Domain Connect provider id", kind: "text", envVar: "DOMAIN_CONNECT_PROVIDER_ID", help: "Once Briefly has published a Domain Connect template: enables one-click DNS at hosts that support it." },
      { key: "domainConnectServiceId", label: "Domain Connect service id", kind: "text", envVar: "DOMAIN_CONNECT_SERVICE_ID" },
    ],
  },
  {
    key: "brevo",
    name: "Brevo",
    category: "email",
    summary: "An alternative sender, used when Resend is not connected. Priced per email rather than per contact.",
    docsUrl: "https://app.brevo.com/settings/keys/api",
    docsLabel: "Brevo → SMTP & API → API keys",
    primaryField: "apiKey",
    testable: true,
    whenMissing: "Nothing, while Resend is connected. Without either, email is only written to the in-app mailbox.",
    fields: [
      { key: "apiKey", label: "API key", kind: "secret", placeholder: "xkeysib-…", required: true, envVar: "BREVO_API_KEY" },
      { key: "from", label: "From address", kind: "text", placeholder: "Briefly <hello@yourdomain.com>", envVar: "EMAIL_FROM", help: "Must be a sender you have verified with Brevo." },
    ],
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
    summary: "Generates the pictures Creative Studio cannot draw itself, through Higgsfield's models.",
    docsUrl: "https://console.higgsfield.ai",
    docsLabel: "Higgsfield console → API keys",
    primaryField: "apiKey",
    testable: true,
    whenMissing: "Creative Studio uses only your own media and Briefly's own renderer. Nothing is generated.",
    fields: [
      { key: "apiKey", label: "Credentials", kind: "secret", placeholder: "key-id:key-secret", required: true, envVar: "HF_CREDENTIALS", help: "Both halves of the key from the Higgsfield console, joined by a colon." },
      { key: "imageModel", label: "Image model", kind: "text", placeholder: "higgsfield-ai/soul/v2/standard", envVar: "HIGGSFIELD_IMAGE_MODEL", help: "The text-to-image model Studio asks for pictures. Leave empty for Soul." },
      { key: "baseUrl", label: "Base URL", kind: "url", placeholder: "https://api.higgsfield.ai", envVar: "HIGGSFIELD_BASE_URL" },
    ],
  },
  {
    key: "browserbase",
    name: "Browserbase",
    category: "rendering",
    summary: "Runs the browser that lays out print pages and draws Studio frames in the cloud, so this server does not have to carry a Chromium.",
    docsUrl: "https://www.browserbase.com/settings",
    docsLabel: "Browserbase → Settings → API keys",
    primaryField: "apiKey",
    testable: true,
    whenMissing: "Pages and frames are rendered by the Chromium on this server, which needs a plan with enough memory for it.",
    fields: [
      { key: "apiKey", label: "API key", kind: "secret", placeholder: "bb_live_…", required: true, envVar: "BROWSERBASE_API_KEY" },
      { key: "projectId", label: "Project ID", kind: "text", placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", envVar: "BROWSERBASE_PROJECT_ID", help: "From Settings → Projects. Leave empty to use the key's default project." },
      { key: "region", label: "Region", kind: "text", placeholder: "eu-central-1", envVar: "BROWSERBASE_REGION", help: "us-west-2, us-east-1, eu-central-1 or ap-southeast-1. Leave empty to let Browserbase choose." },
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
  rendering: "Rendering",
  storage: "Storage",
};

export function integrationByKey(key: string) {
  return INTEGRATIONS.find((i) => i.key === key) ?? null;
}

/** The settings row an integration's values live in. */
export function settingKeyFor(integration: string) {
  return `integration:${integration}`;
}
