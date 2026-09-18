import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { getStorage, extensionForMime } from "@/server/storage";
import { hasFeature } from "@/server/billing/entitlements";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/action-result";
import { getSpeechProvider, speechConfig } from "./providers";
import { recordSpeechUsage } from "./usage";

const log = createLogger("speech-clones");

/**
 * Borrowing a real person's voice.
 *
 * Three locks, all of which must be open: the platform's switch, the plan's switch, and consent
 * recorded in the person's own words with the name of who recorded it. Nothing here is ever
 * triggered by the system on its own — not for a founder whose interview is in the edition, not
 * for the editor whose byline is on every page. The samples are uploaded by a person, the consent
 * is typed by a person, and both are kept with the clone for as long as it exists.
 */

export const RELATIONS = ["founder", "executive", "employee", "contributor", "other"] as const;

export type CloneRequest = {
  organizationId: string;
  name: string;
  personName: string;
  relation: (typeof RELATIONS)[number];
  language?: string | null;
  consentText: string;
  consentConfirmed: boolean;
  samples: { bytes: Buffer; fileName: string; mimeType: string }[];
  actorId: string;
};

const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/webm", "audio/ogg", "audio/flac"]);

export async function listVoiceClones(organizationId: string) {
  return db.query.voiceClones.findMany({ where: eq(s.voiceClones.organizationId, organizationId), orderBy: (clone, { desc }) => [desc(clone.createdAt)] });
}

export async function requestVoiceClone(input: CloneRequest) {
  const config = await speechConfig();
  if (!config.cloningEnabled) throw new ForbiddenError("Voice cloning is switched off on this Briefly.");
  if (!(await hasFeature(input.organizationId, "voiceCloning"))) throw new ForbiddenError("Voice cloning is not included in your plan.");
  if (!input.consentConfirmed) throw new ValidationError("Consent has to be confirmed before a voice is cloned.");
  if (input.consentText.trim().length < 40) throw new ValidationError("Write down the consent in the person's own words — at least a sentence.");
  if (!input.personName.trim() || !input.name.trim()) throw new ValidationError("Name the person and the voice.");
  if (!input.samples.length || input.samples.length > 5) throw new ValidationError("Upload one to five recordings of the person speaking.");
  for (const sample of input.samples) {
    if (sample.bytes.length > MAX_SAMPLE_BYTES) throw new ValidationError(`${sample.fileName} is over 10 MB.`);
    if (!ALLOWED_MIME.has(sample.mimeType)) throw new ValidationError(`${sample.fileName} is not an audio file Briefly can use.`);
  }
  const provider = await getSpeechProvider("FINAL");
  if (!provider?.cloneVoice) throw new ValidationError("The premium voice service is not connected, so a voice cannot be cloned yet.");

  const [row] = await db
    .insert(s.voiceClones)
    .values({
      organizationId: input.organizationId,
      name: input.name.trim(),
      personName: input.personName.trim(),
      relation: input.relation,
      language: input.language ?? null,
      consentText: input.consentText.trim(),
      consentGrantedById: input.actorId,
      consentGrantedAt: new Date(),
      provider: provider.name,
      status: "PENDING",
      createdById: input.actorId,
    })
    .returning();

  const storage = await getStorage();
  const keys: string[] = [];
  for (const [index, sample] of input.samples.entries()) {
    const key = `voices/${row.id}/sample-${index + 1}.${extensionForMime(sample.mimeType)}`;
    await storage.put(key, sample.bytes, { contentType: sample.mimeType });
    keys.push(key);
  }
  await db.update(s.voiceClones).set({ sampleKeys: keys }).where(eq(s.voiceClones.id, row.id));

  await audit({ action: "voice.clone.request", organizationId: input.organizationId, userId: input.actorId, entityType: "SETTING", entityId: row.id, metadata: { person: row.personName, relation: row.relation, samples: keys.length, consentGrantedAt: row.consentGrantedAt.toISOString() } });

  try {
    const result = await provider.cloneVoice({ name: `${row.name} (Briefly)`, description: `Consented clone recorded for ${row.personName}`, language: row.language, samples: input.samples });
    const [ready] = await db.update(s.voiceClones).set({ providerVoiceId: result.voiceId, status: "READY", updatedAt: new Date() }).where(eq(s.voiceClones.id, row.id)).returning();
    await recordSpeechUsage({ organizationId: input.organizationId, provider: provider.name, operation: "clone", costCents: 0, createdById: input.actorId });
    await audit({ action: "voice.clone.ready", organizationId: input.organizationId, userId: input.actorId, entityType: "SETTING", entityId: row.id, metadata: { provider: provider.name } });
    log.info("voice cloned", { cloneId: row.id, provider: provider.name });
    return ready;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [failed] = await db.update(s.voiceClones).set({ status: "FAILED", error: message.slice(0, 500), updatedAt: new Date() }).where(eq(s.voiceClones.id, row.id)).returning();
    await audit({ action: "voice.clone.failed", organizationId: input.organizationId, userId: input.actorId, entityType: "SETTING", entityId: row.id, metadata: { error: message.slice(0, 200) } });
    return failed;
  }
}

/** Withdraw it: gone at the provider, gone from the house voice, kept here as a record with its consent. */
export async function revokeVoiceClone(cloneId: string, organizationId: string, actorId: string) {
  const clone = await db.query.voiceClones.findFirst({ where: eq(s.voiceClones.id, cloneId) });
  if (!clone || clone.organizationId !== organizationId) throw new NotFoundError("Voice");
  if (clone.providerVoiceId) {
    const provider = await getSpeechProvider("FINAL");
    if (provider?.deleteVoice) await provider.deleteVoice(clone.providerVoiceId).catch((error) => log.warn("could not delete the cloned voice at the provider", { cloneId, error: error instanceof Error ? error.message : String(error) }));
  }
  const storage = await getStorage();
  for (const key of clone.sampleKeys) await storage.delete(key).catch(() => {});
  await db.update(s.brandVoices).set({ cloneId: null, updatedAt: new Date() }).where(eq(s.brandVoices.cloneId, clone.id));
  const [row] = await db.update(s.voiceClones).set({ status: "REVOKED", revokedAt: new Date(), revokedById: actorId, providerVoiceId: null, sampleKeys: [], updatedAt: new Date() }).where(eq(s.voiceClones.id, clone.id)).returning();
  await audit({ action: "voice.clone.revoke", organizationId, userId: actorId, entityType: "SETTING", entityId: clone.id, metadata: { person: clone.personName } });
  return row;
}
