import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { integrationConfig, integrationValue, saveIntegration } from "./service";
import { accountSummary, provisionPlanPrices, provisionWebhook, WEBHOOK_EVENTS } from "@/server/billing/stripe";

const log = createLogger("setup");

/**
 * Finish connecting a service, in one action.
 *
 * Pasting an API key is the easy half. The half that goes wrong is everything after: creating a
 * webhook endpoint with exactly the right events and copying a signing secret across without
 * mistyping it, creating a product and two prices per plan and pasting six identifiers back, finding
 * which of your verified senders is the one to send from, knowing which model names your account can
 * actually reach. Each of those is a step somebody skips, and skipping most of them fails silently —
 * payments work and nothing updates, email sends and lands in spam.
 *
 * So the console asks for the one thing only the customer has, the key, and then does the rest by
 * calling the service. Every step reports what it did in a sentence a person can check, because
 * "Done ✓" is not an answer when the question is whether your billing works.
 *
 * Each step is idempotent. Running setup twice is a normal thing to do — after changing a plan's
 * price, after moving from test keys to live ones — and it must not leave a customer able to buy the
 * same plan at two amounts.
 */

export type SetupStep = { label: string; detail: string; ok: boolean };
export type SetupResult = { ok: boolean; summary: string; steps: SetupStep[] };

const fail = (summary: string, steps: SetupStep[] = []): SetupResult => ({ ok: false, summary, steps });

/* ── Stripe ───────────────────────────────────────────────────────────────────────────────── */

async function setUpStripe(actorId?: string | null): Promise<SetupResult> {
  const key = await integrationValue("stripe", "secretKey");
  if (!key) return fail("Add your Stripe secret key first, then run setup.");

  const steps: SetupStep[] = [];

  let account: Awaited<ReturnType<typeof accountSummary>>;
  try {
    account = await accountSummary();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Stripe rejected that key.");
  }
  steps.push({
    label: "Account",
    detail: `${account.name ?? account.id} · ${account.livemode ? "live mode" : "test mode"}`,
    ok: true,
  });

  // 1. The webhook. Without it Stripe takes the money and Briefly never hears about it.
  const url = `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/api/webhooks/stripe`;
  try {
    const { endpoint, replaced } = await provisionWebhook(url);
    if (endpoint.secret) {
      await saveIntegration("stripe", { webhookSecret: endpoint.secret }, actorId);
      steps.push({
        label: "Webhook",
        detail: `${replaced ? "Replaced the endpoint at" : "Created an endpoint at"} ${url}, subscribed to ${WEBHOOK_EVENTS.length} events. Signing secret stored.`,
        ok: true,
      });
    } else {
      steps.push({ label: "Webhook", detail: "Stripe created the endpoint but returned no signing secret. Copy it from the dashboard.", ok: false });
    }
  } catch (error) {
    steps.push({ label: "Webhook", detail: error instanceof Error ? error.message : "Could not create the endpoint.", ok: false });
  }

  // 2. Products and prices, for every plan that costs money.
  const plans = await db.query.plans.findMany();
  const priced = plans.filter((p) => !p.isCustomPriced && p.priceMonthlyCents > 0);
  let linked = 0;
  for (const plan of priced) {
    try {
      const result = await provisionPlanPrices(plan);
      await db
        .update(s.plans)
        .set({ stripeProductId: result.productId, stripeMonthlyPriceId: result.monthlyPriceId, stripeYearlyPriceId: result.yearlyPriceId })
        .where(eq(s.plans.id, plan.id));
      linked += 1;
    } catch (error) {
      log.error("plan provisioning failed", { plan: plan.key, error: String(error) });
      steps.push({ label: plan.name, detail: error instanceof Error ? error.message : "Could not create prices.", ok: false });
    }
  }
  if (linked) {
    steps.push({
      label: "Plans",
      detail: `${linked} plan${linked === 1 ? "" : "s"} now has a Stripe product and prices. Customers can buy ${priced.map((p) => p.name).join(", ")}.`,
      ok: true,
    });
  } else if (!priced.length) {
    steps.push({ label: "Plans", detail: "No priced plans yet — add one in Customers & plans and run this again.", ok: true });
  }

  const ok = steps.every((step) => step.ok);
  return {
    ok,
    summary: ok ? `Stripe is connected in ${account.livemode ? "live" : "test"} mode and ready to charge.` : "Stripe is connected, but some steps need attention.",
    steps,
  };
}

/* ── Brevo ────────────────────────────────────────────────────────────────────────────────── */

type BrevoSender = { id: number; name: string; email: string; active: boolean };

/**
 * Pick the sender.
 *
 * Brevo will not deliver from an address it has not verified, and a Briefly configured with an
 * unverified one fails at the worst possible moment — the first edition send. So we ask Brevo which
 * addresses it will accept and use one of those, rather than trusting whatever was typed.
 */
async function setUpBrevo(actorId?: string | null): Promise<SetupResult> {
  const key = await integrationValue("brevo", "apiKey");
  if (!key) return fail("Add your Brevo API key first, then run setup.");

  const res = await fetch("https://api.brevo.com/v3/senders", {
    headers: { "api-key": key, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res?.ok) return fail(res ? `Brevo responded ${res.status}. Check the key has the Senders scope.` : "Could not reach Brevo.");

  const { senders = [] } = (await res.json().catch(() => ({}))) as { senders?: BrevoSender[] };
  const usable = senders.filter((sender) => sender.active);
  if (!usable.length) {
    return fail("Brevo has no verified sender yet. Add and verify one in Brevo, then run this again.", [
      { label: "Senders", detail: `${senders.length} sender${senders.length === 1 ? "" : "s"} found, none verified.`, ok: false },
    ]);
  }

  const current = await integrationValue("brevo", "from");
  const alreadyValid = current && usable.some((sender) => current.includes(sender.email));
  const chosen = usable[0];
  const from = alreadyValid ? current : `${chosen.name} <${chosen.email}>`;
  if (!alreadyValid) await saveIntegration("brevo", { from }, actorId);

  return {
    ok: true,
    summary: `Brevo will send as ${from}.`,
    steps: [
      { label: "Senders", detail: `${usable.length} verified address${usable.length === 1 ? "" : "es"}: ${usable.map((sender) => sender.email).join(", ")}.`, ok: true },
      { label: "From address", detail: alreadyValid ? `Kept ${current} — it is one of your verified senders.` : `Set to ${from}.`, ok: true },
    ],
  };
}

/* ── OpenAI ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Model names change, and an account cannot always reach the newest.
 *
 * Preference order, most capable first. Whatever the account actually lists wins, so a key with
 * limited access gets something that works rather than a 404 on the first pipeline run.
 */
const STRONG_MODELS = ["gpt-5", "gpt-4.1", "gpt-4o", "gpt-4-turbo"];
const FAST_MODELS = ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-3.5-turbo"];

async function setUpOpenAi(actorId?: string | null): Promise<SetupResult> {
  const key = await integrationValue("openai", "apiKey");
  if (!key) return fail("Add your OpenAI API key first, then run setup.");
  const base = (await integrationValue("openai", "baseUrl")) || "https://api.openai.com/v1";

  const res = await fetch(`${base.replace(/\/$/, "")}/models`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);

  if (!res?.ok) return fail(res ? `OpenAI responded ${res.status}. Check the key is active and has model access.` : "Could not reach OpenAI.");

  const { data = [] } = (await res.json().catch(() => ({}))) as { data?: { id: string }[] };
  const available = new Set(data.map((model) => model.id));
  const pick = (preferences: string[]) => preferences.find((id) => available.has(id)) ?? null;

  const strong = pick(STRONG_MODELS);
  const fast = pick(FAST_MODELS) ?? strong;
  if (!strong) {
    return fail("That key cannot reach any model Briefly knows how to use.", [
      { label: "Models", detail: `${available.size} models visible, none of them a chat model Briefly supports.`, ok: false },
    ]);
  }

  await saveIntegration("openai", { modelStrong: strong, modelFast: fast ?? strong }, actorId);
  return {
    ok: true,
    summary: `Drafting with ${strong}, triage with ${fast}.`,
    steps: [
      { label: "Access", detail: `${available.size} models visible to this key.`, ok: true },
      { label: "Strong model", detail: `${strong} — clustering, drafting, fact checks.`, ok: true },
      { label: "Fast model", detail: `${fast} — triage and the high-volume passes.`, ok: true },
    ],
  };
}

/* ── Storage ──────────────────────────────────────────────────────────────────────────────── */

/**
 * There is nothing to call here, so this checks rather than provisions.
 *
 * A bucket with no credentials is the configuration that looks finished and fails on the first
 * upload, so saying so plainly is the whole value.
 */
async function checkStorage(): Promise<SetupResult> {
  const config = await integrationConfig("storage");
  const missing = (["bucket", "accessKeyId", "secretAccessKey"] as const).filter((field) => !config[field]);
  if (missing.length) {
    return fail(`Storage is incomplete: ${missing.join(", ")} missing. Uploads are going to local disk, which most hosts wipe on redeploy.`);
  }
  return {
    ok: true,
    summary: `Uploads go to ${config.bucket}${config.region ? ` in ${config.region}` : ""}.`,
    steps: [{ label: "Bucket", detail: `${config.bucket} · ${config.endpoint || "AWS S3"}`, ok: true }],
  };
}

/* ── Entry point ──────────────────────────────────────────────────────────────────────────── */

/** Which integrations have a setup step worth offering. */
/* ── Resend ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Finish connecting delivery: the webhook that reports what happened to every message, and the
 * shared domain customers send from until their own is verified. Both are things a person would
 * otherwise do by hand in two dashboards with a signing secret in the clipboard in between.
 */
async function setUpResend(actorId?: string | null): Promise<SetupResult> {
  const { getEmailProvider } = await import("@/server/email/providers");
  const { RESEND_WEBHOOK_EVENTS } = await import("@/server/email/providers/resend");
  const provider = await getEmailProvider();
  if (!provider) return fail("Add your Resend API key first, then run setup.");
  const steps: SetupStep[] = [];
  const endpoint = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/resend`;

  try {
    const hooks = await provider.listWebhooks();
    const existing = hooks.find((hook) => hook.endpoint === endpoint);
    if (existing) {
      const secret = existing.secret ?? (await provider.getWebhook(existing.id)).secret;
      if (secret) await saveIntegration("resend", { webhookSecret: secret }, actorId);
      steps.push({ label: "Webhook", detail: secret ? `Already pointing at ${endpoint}; signing secret stored.` : `Already pointing at ${endpoint}, but Resend did not hand back its signing secret — rotate it in Resend and paste it here.`, ok: Boolean(secret) });
    } else {
      const created = await provider.createWebhook(endpoint, [...RESEND_WEBHOOK_EVENTS]);
      await saveIntegration("resend", { webhookSecret: created.secret }, actorId);
      steps.push({ label: "Webhook", detail: `Created for ${endpoint}: deliveries, bounces, complaints, opens, clicks and domain changes now reach Briefly. Signing secret stored.`, ok: true });
    }
  } catch (err) {
    steps.push({ label: "Webhook", detail: err instanceof Error ? err.message : String(err), ok: false });
  }

  const shared = (await integrationValue("resend", "sharedDomain"))?.trim().toLowerCase();
  if (!shared) {
    steps.push({ label: "Briefly sending domain", detail: "Not set. Customers can only send once their own domain is verified. Add one, e.g. send.briefly.press, and run setup again.", ok: false });
  } else {
    try {
      const region = (await integrationValue("resend", "region"))?.trim() || "eu-west-1";
      const domains = await provider.listDomains();
      let domain = domains.find((candidate) => candidate.name.toLowerCase() === shared) ?? null;
      let created = false;
      if (!domain) {
        domain = await provider.createDomain(shared, { region });
        created = true;
      } else {
        domain = await provider.getDomain(domain.id);
      }
      if (domain.status === "verified") {
        steps.push({ label: "Briefly sending domain", detail: `${shared} is verified. Customers send as “via Briefly” from it until their own domain is ready.`, ok: true });
      } else {
        const records = domain.records.map((record) => `${record.type} ${record.name} → ${record.value}${record.priority !== undefined ? ` (priority ${record.priority})` : ""}`).join("; ");
        steps.push({ label: "Briefly sending domain", detail: `${shared} is ${created ? "registered" : domain.status.replace("_", " ")}. Publish these DNS records, then run setup again: ${records}`, ok: false });
      }
    } catch (err) {
      steps.push({ label: "Briefly sending domain", detail: err instanceof Error ? err.message : String(err), ok: false });
    }
  }

  const ok = steps.every((step) => step.ok);
  await audit({ action: "integration.setup", userId: actorId, metadata: { integration: "resend", ok, steps: steps.map((step) => step.label) } });
  return { ok, summary: ok ? "Delivery is set up: every message reports back, and customers can send before their own domain is ready." : "Delivery is partly set up — see the steps below.", steps };
}

/* ── Voices ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Put a real voice behind every one of Briefly's named voices.
 *
 * The catalogue names slots — "Premium · Female · France" — and this fills them from the account:
 * a slot whose default voice the account already has keeps it; a slot with none is filled from the
 * provider's shared library by language, gender and accent, added to the account, and written into
 * the map. The map is what the narration engine reads, so a platform admin can later swap any slot
 * for a voice they prefer by editing one line, and nothing else changes.
 */
async function setUpVoices(actorId?: string | null): Promise<SetupResult> {
  const { ElevenLabsProvider } = await import("@/server/speech/providers/elevenlabs");
  const { CURATED_VOICES, resolveCatalogue } = await import("@/lib/speech/voices");
  const { LANGUAGE_NAMES } = await import("@/lib/speech/language");
  const config = await integrationConfig("elevenlabs");
  if (!config.apiKey) return fail("Add your ElevenLabs API key first, then run setup.");
  const provider = new ElevenLabsProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  const steps: SetupStep[] = [];

  let mapping: Record<string, string> = {};
  try {
    mapping = config.voiceCatalog ? (JSON.parse(config.voiceCatalog) as Record<string, string>) : {};
  } catch {
    return fail("The curated voices field is not valid JSON. Clear it, or fix it, then run setup again.");
  }

  let account;
  try {
    account = await provider.account();
    steps.push({ label: "Account", detail: `${account.label}${account.charactersLimit ? ` · ${(account.charactersUsed ?? 0).toLocaleString()} of ${account.charactersLimit.toLocaleString()} characters used this period` : ""}`, ok: true });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "ElevenLabs rejected that key.");
  }

  let owned;
  try {
    owned = await provider.listVoices();
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Could not list the account's voices.", steps);
  }
  const ownedIds = new Set(owned.map((voice) => voice.id));

  const kept: string[] = [];
  const added: string[] = [];
  const empty: string[] = [];
  const next: Record<string, string> = {};
  for (const entry of resolveCatalogue(mapping)) {
    const slot = entry.voice;
    if (entry.providerVoiceId && ownedIds.has(entry.providerVoiceId)) {
      if (entry.source === "mapped") next[slot.key] = entry.providerVoiceId;
      kept.push(slot.key);
      continue;
    }
    // Mapped to something the account no longer has, or a default this account lacks, or nothing:
    // find one in the library that speaks the language natively.
    try {
      const candidates = (await provider.searchSharedVoices({ language: slot.search.language, gender: slot.search.gender, accent: slot.search.accent ?? null, useCase: slot.search.useCase ?? null, query: slot.search.query ?? null, pageSize: 30 }))
        .filter((voice) => voice.languages.some((entry) => entry.language === slot.language) || voice.labels.language === slot.language)
        .sort((a, b) => Number(b.featured) - Number(a.featured) || b.popularity - a.popularity);
      const pick = candidates[0];
      if (!pick) {
        empty.push(slot.key);
        continue;
      }
      const alreadyOwned = owned.find((voice) => voice.id === pick.id || voice.name === pick.name);
      const voiceId = alreadyOwned ? alreadyOwned.id : (await provider.addSharedVoice(pick, `${pick.name} · Briefly ${slot.key}`)).voiceId;
      next[slot.key] = voiceId;
      added.push(`${slot.label.en} ← ${pick.name}`);
    } catch (error) {
      empty.push(slot.key);
      log.warn("could not fill a voice slot", { slot: slot.key, error: error instanceof Error ? error.message : String(error) });
    }
  }

  await saveIntegration("elevenlabs", { voiceCatalog: JSON.stringify(next) }, actorId);
  const spoken = [...new Set(CURATED_VOICES.filter((voice) => kept.includes(voice.key) || voice.key in next).map((voice) => voice.language))];
  const silent = [...new Set(CURATED_VOICES.map((voice) => voice.language))].filter((language) => !spoken.includes(language));
  steps.push({ label: "Voices", detail: `${kept.length} slot${kept.length === 1 ? "" : "s"} already had a voice${added.length ? `; ${added.length} filled from the library: ${added.join(", ")}` : ""}${empty.length ? `; ${empty.length} still empty (${empty.join(", ")})` : ""}.`, ok: empty.length === 0 });
  steps.push({ label: "Languages", detail: `Narration available in ${spoken.map((language) => LANGUAGE_NAMES.en[language]).join(", ") || "no language yet"}${silent.length ? `; not yet in ${silent.map((language) => LANGUAGE_NAMES.en[language]).join(", ")}` : ""}.`, ok: spoken.includes("fr") && spoken.includes("en") });

  const ok = steps.every((step) => step.ok);
  await audit({ action: "integration.setup", userId: actorId, metadata: { integration: "elevenlabs", ok, kept: kept.length, added: added.length, empty } });
  return { ok, summary: ok ? "Every named voice has a real one behind it. Customers can narrate in every language Briefly offers." : "Voices are partly set up — see the steps below. Map the empty slots by hand, or run setup again later.", steps };
}

export const SETUP_SUPPORTED = ["stripe", "brevo", "resend", "openai", "elevenlabs", "storage"] as const;

export async function runSetup(integrationKey: string, actorId?: string | null): Promise<SetupResult> {
  const run = async () => {
    switch (integrationKey) {
      case "stripe":
        return setUpStripe(actorId);
      case "brevo":
        return setUpBrevo(actorId);
      case "resend":
        return setUpResend(actorId);
      case "openai":
        return setUpOpenAi(actorId);
      case "elevenlabs":
        return setUpVoices(actorId);
      case "storage":
        return checkStorage();
      default:
        return fail("This integration has nothing to set up beyond its credentials.");
    }
  };

  const result = await run().catch((error): SetupResult => fail(error instanceof Error ? error.message : "Setup failed."));
  await audit({
    action: "integration.setup",
    entityType: "SETTING",
    userId: actorId ?? null,
    metadata: { integration: integrationKey, ok: result.ok, steps: result.steps.map((step) => `${step.label}: ${step.ok ? "ok" : "failed"}`) },
  });
  return result;
}
