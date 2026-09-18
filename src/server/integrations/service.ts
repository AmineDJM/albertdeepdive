import { cache } from "react";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { maskSecret, open, readSecretSetting, seal, writeSecretSetting, type SealedSecret } from "@/server/settings/secrets";
import { NotFoundError } from "@/lib/action-result";
import { INTEGRATIONS, integrationByKey, settingKeyFor, type IntegrationDefinition } from "./registry";

const log = createLogger("integrations");

/**
 * Reading and writing integration settings.
 *
 * Secrets typed into the interface are sealed before they touch the database and are never read
 * back out to the browser — the console shows a mask and the last four characters, which is enough
 * to recognise a key and not enough to use one.
 *
 * Environment variables win over stored values. A platform that injects secrets at deploy time
 * should not have them silently overridden by something somebody typed, and the console says which
 * fields are locked that way.
 */

type StoredIntegration = { values: Record<string, string | SealedSecret>; updatedAt?: string };

function isSealed(value: unknown): value is SealedSecret {
  return typeof value === "object" && value !== null && (value as SealedSecret).v === 1;
}

async function readStored(key: string): Promise<StoredIntegration> {
  return (await readSecretSetting<StoredIntegration>(settingKeyFor(key))) ?? { values: {} };
}

/** The environment answer for one field, without touching the database. */
function envValue(definition: IntegrationDefinition, fieldKey: string): string | null {
  const field = definition.fields.find((f) => f.key === fieldKey);
  const name = field?.envVar;
  return name ? (process.env[name] ?? null) : null;
}

/** Resolve one field: environment first, then what was stored, then nothing. */
function resolveField(definition: IntegrationDefinition, fieldKey: string, stored: StoredIntegration): { value: string | null; source: "env" | "stored" | "none" } {
  const field = definition.fields.find((f) => f.key === fieldKey);
  if (!field) return { value: null, source: "none" };

  const fromEnv = envValue(definition, fieldKey);
  if (fromEnv) return { value: fromEnv, source: "env" };

  const raw = stored.values[fieldKey];
  if (raw === undefined) return { value: null, source: "none" };
  const value = isSealed(raw) ? open(raw) : String(raw);
  return value ? { value, source: "stored" } : { value: null, source: "none" };
}

/**
 * The live value of one setting, for the code that actually calls the service.
 *
 * Not cached across requests on purpose: connecting Stripe in the console has to take effect on the
 * next call, not after a restart.
 */
export async function integrationValue(integrationKey: string, fieldKey: string): Promise<string | null> {
  const definition = integrationByKey(integrationKey);
  if (!definition) return null;
  // Environment first, and short-circuited: an install that injects its secrets at deploy time
  // should never pay for a database round trip to be told what it already knows.
  const fromEnv = envValue(definition, fieldKey);
  if (fromEnv) return fromEnv;
  const stored = await readStored(integrationKey);
  return resolveField(definition, fieldKey, stored).value;
}

/** Every field of one integration, resolved. */
export async function integrationConfig(integrationKey: string): Promise<Record<string, string | null>> {
  const definition = integrationByKey(integrationKey);
  if (!definition) return {};
  const stored = await readStored(integrationKey);
  return Object.fromEntries(definition.fields.map((f) => [f.key, resolveField(definition, f.key, stored).value]));
}

export async function isConfigured(integrationKey: string): Promise<boolean> {
  const definition = integrationByKey(integrationKey);
  if (!definition) return false;
  return Boolean(await integrationValue(integrationKey, definition.primaryField));
}

export type IntegrationStatus = {
  key: string;
  name: string;
  category: IntegrationDefinition["category"];
  summary: string;
  docsUrl?: string;
  docsLabel?: string;
  whenMissing: string;
  testable: boolean;
  configured: boolean;
  fields: {
    key: string;
    label: string;
    kind: IntegrationDefinition["fields"][number]["kind"];
    placeholder?: string;
    help?: string;
    required: boolean;
    options?: { value: string; label: string }[];
    /** Secrets come back masked; everything else comes back as it is. */
    display: string | null;
    source: "env" | "stored" | "none";
    envVar?: string;
  }[];
};

/** What the console shows. Secrets are masked here and nowhere else undoes it. */
export const integrationStatuses = cache(async (): Promise<IntegrationStatus[]> => {
  const statuses: IntegrationStatus[] = [];
  for (const definition of INTEGRATIONS) {
    const stored = await readStored(definition.key);
    const fields = definition.fields.map((field) => {
      const { value, source } = resolveField(definition, field.key, stored);
      return {
        key: field.key,
        label: field.label,
        kind: field.kind,
        placeholder: field.placeholder,
        help: field.help,
        required: field.required ?? false,
        options: field.options,
        display: field.kind === "secret" ? maskSecret(value) : value,
        source,
        envVar: field.envVar,
      };
    });
    statuses.push({
      key: definition.key,
      name: definition.name,
      category: definition.category,
      summary: definition.summary,
      docsUrl: definition.docsUrl,
      docsLabel: definition.docsLabel,
      whenMissing: definition.whenMissing,
      testable: definition.testable ?? false,
      configured: Boolean(fields.find((f) => f.key === definition.primaryField)?.display),
      fields,
    });
  }
  return statuses;
});

/**
 * Save one integration.
 *
 * An empty string for a secret means "leave it as it is", not "clear it" — otherwise the console,
 * which never shows the real value, would wipe a working key every time somebody saved an unrelated
 * field. Clearing is a separate, explicit action.
 */
export async function saveIntegration(integrationKey: string, patch: Record<string, string>, userId?: string | null) {
  const definition = integrationByKey(integrationKey);
  if (!definition) throw new NotFoundError("Integration");
  const stored = await readStored(integrationKey);
  const values = { ...stored.values };

  for (const field of definition.fields) {
    if (!(field.key in patch)) continue;
    const next = patch[field.key]?.trim() ?? "";
    if (field.kind === "secret" && next === "") continue;
    if (next === "") {
      delete values[field.key];
      continue;
    }
    values[field.key] = field.kind === "secret" ? seal(next) : next;
  }

  await writeSecretSetting(settingKeyFor(integrationKey), { values, updatedAt: new Date().toISOString() }, `${definition.name} integration`, userId);
  await audit({ action: "integration.save", userId, metadata: { integration: integrationKey, fields: Object.keys(patch) } });
  log.info("integration saved", { integration: integrationKey });
}

export async function clearIntegration(integrationKey: string, userId?: string | null) {
  const definition = integrationByKey(integrationKey);
  if (!definition) throw new NotFoundError("Integration");
  await writeSecretSetting(settingKeyFor(integrationKey), { values: {}, updatedAt: new Date().toISOString() }, `${definition.name} integration`, userId);
  await audit({ action: "integration.clear", userId, metadata: { integration: integrationKey } });
}

export type IntegrationTestResult = { ok: boolean; message: string };

/**
 * Try the credentials against the real service.
 *
 * "Saved" and "working" are different things, and the difference is usually discovered at the worst
 * moment — when an edition fails to send. Each test is the cheapest authenticated call the provider
 * offers, and the message says what came back rather than just "failed".
 */
export async function testIntegration(integrationKey: string): Promise<IntegrationTestResult> {
  const config = await integrationConfig(integrationKey);

  try {
    switch (integrationKey) {
      case "stripe": {
        if (!config.secretKey) return { ok: false, message: "No secret key saved yet." };
        const res = await fetch("https://api.stripe.com/v1/products?limit=1", {
          headers: { authorization: `Bearer ${config.secretKey}` },
          signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) {
          const live = config.secretKey.startsWith("sk_live_");
          return { ok: true, message: live ? "Connected to Stripe in live mode." : "Connected to Stripe in test mode." };
        }
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        return { ok: false, message: body.error?.message ?? `Stripe answered ${res.status}.` };
      }

      case "brevo": {
        if (!config.apiKey) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": config.apiKey, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
        if (res.ok) {
          const account = (await res.json().catch(() => ({}))) as { email?: string; companyName?: string };
          return { ok: true, message: `Connected as ${account.companyName ?? account.email ?? "your Brevo account"}.` };
        }
        return { ok: false, message: res.status === 401 ? "Brevo rejected that key." : `Brevo answered ${res.status}.` };
      }

      case "resend": {
        if (!config.apiKey) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.resend.com/domains", { headers: { authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(12_000) });
        if (!res.ok) return { ok: false, message: res.status === 401 ? "Resend rejected that key." : `Resend answered ${res.status}.` };
        const body = (await res.json().catch(() => ({}))) as { data?: { name: string; status: string }[] };
        const domains = body.data ?? [];
        const shared = config.sharedDomain?.trim().toLowerCase();
        if (!shared) return { ok: true, message: `Connected. ${domains.length} domain${domains.length === 1 ? "" : "s"} in the account. Add a Briefly sending domain so customers can send before their own is ready.` };
        const mine = domains.find((domain) => domain.name.toLowerCase() === shared);
        if (!mine) return { ok: true, message: `Connected, but ${shared} is not registered in Resend yet — run “Set up delivery”.` };
        return mine.status === "verified"
          ? { ok: true, message: `Connected. Customers send as “via Briefly” from ${shared} until their own domain is ready.` }
          : { ok: true, message: `Connected, but ${shared} is ${mine.status.replace("_", " ")} in Resend: its DNS records still need publishing.` };
      }

      case "openai": {
        if (!config.apiKey) return { ok: false, message: "No API key saved yet." };
        const base = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
        const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${config.apiKey}` }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) return { ok: false, message: res.status === 401 ? "That key was rejected." : `The API answered ${res.status}.` };
        const body = (await res.json().catch(() => ({ data: [] }))) as { data?: { id: string }[] };
        const names = new Set((body.data ?? []).map((m) => m.id));
        const missing = [config.modelFast, config.modelStrong].filter((m): m is string => !!m && names.size > 0 && !names.has(m));
        return missing.length
          ? { ok: true, message: `Connected, but this key cannot see ${missing.join(" or ")}.` }
          : { ok: true, message: `Connected. ${names.size} model${names.size === 1 ? "" : "s"} available.` };
      }

      case "elevenlabs": {
        if (!config.apiKey) return { ok: false, message: "No API key saved yet." };
        const { ElevenLabsProvider } = await import("@/server/speech/providers/elevenlabs");
        const { resolveCatalogue } = await import("@/lib/speech/voices");
        const { LANGUAGE_NAMES } = await import("@/lib/speech/language");
        const provider = new ElevenLabsProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
        const account = await provider.account!();
        let catalogue: Record<string, string> = {};
        try {
          catalogue = config.voiceCatalog ? (JSON.parse(config.voiceCatalog) as Record<string, string>) : {};
        } catch {
          return { ok: false, message: "The curated voices field is not valid JSON." };
        }
        const resolved = resolveCatalogue(catalogue);
        const spoken = [...new Set(resolved.filter((entry) => entry.providerVoiceId).map((entry) => entry.voice.language))];
        const silent = [...new Set(resolved.filter((entry) => !entry.providerVoiceId).map((entry) => entry.voice.language))].filter((language) => !spoken.includes(language));
        const usage = account.charactersLimit ? ` · ${(account.charactersUsed ?? 0).toLocaleString()} of ${account.charactersLimit.toLocaleString()} characters used this period` : "";
        const voices = spoken.length ? `Voices set up for ${spoken.map((language) => LANGUAGE_NAMES.en[language]).join(", ")}` : "No voices set up yet";
        const missing = silent.length ? `; none yet for ${silent.map((language) => LANGUAGE_NAMES.en[language]).join(", ")} — run “Set up voices”` : "";
        return { ok: true, message: `Connected (${account.label})${usage}. ${voices}${missing}.` };
      }

      case "higgsfield": {
        if (!config.apiKey) return { ok: false, message: "No credentials saved yet." };
        if (!config.apiKey.includes(":")) return { ok: false, message: "Credentials must be key-id:key-secret, both halves from the Higgsfield console." };
        // There is no "who am I" call; asking after a request that cannot exist tells the two
        // things apart that matter — a key Higgsfield knows (404) and one it does not (401).
        const base = (config.baseUrl || "https://api.higgsfield.ai").replace(/\/+$/, "");
        const res = await fetch(`${base}/requests/00000000-0000-0000-0000-000000000000/status`, { headers: { authorization: `Key ${config.apiKey}`, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
        if (res.status === 401) return { ok: false, message: "Higgsfield rejected those credentials." };
        if (res.status === 403) return { ok: false, message: "The credentials work, but the Higgsfield account has no credits left." };
        if (res.status >= 500) return { ok: false, message: `Higgsfield answered ${res.status}.` };
        return { ok: true, message: `Connected. Pictures will come from ${config.imageModel?.trim() || "higgsfield-ai/soul/v2/standard"}.` };
      }

      case "browserbase": {
        if (!config.apiKey) return { ok: false, message: "No API key saved yet." };
        const res = await fetch("https://api.browserbase.com/v1/projects", { headers: { "x-bb-api-key": config.apiKey, accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
        if (!res.ok) return { ok: false, message: res.status === 401 ? "Browserbase rejected that key." : `Browserbase answered ${res.status}.` };
        const raw = (await res.json().catch(() => [])) as unknown;
        const projects = (Array.isArray(raw) ? raw : ((raw as { projects?: unknown[] })?.projects ?? [])) as { id: string; name: string; concurrency?: number }[];
        const wanted = config.projectId?.trim();
        const project = wanted ? projects.find((p) => p.id === wanted) : projects[0];
        if (wanted && !project) return { ok: false, message: `Connected, but this key cannot see project ${wanted}.` };
        if (!project) return { ok: false, message: "Connected, but the key has no project. Create one in Browserbase first." };
        const browsers = project.concurrency ? `, up to ${project.concurrency} browser${project.concurrency === 1 ? "" : "s"} at once` : "";
        return { ok: true, message: `Connected. Renders will run in “${project.name}”${browsers}.` };
      }

      default:
        return { ok: false, message: "This integration cannot be tested automatically." };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("integration test failed", { integration: integrationKey, err });
    return { ok: false, message: message.includes("timed out") || message.includes("abort") ? "The service did not answer in time." : message };
  }
}
