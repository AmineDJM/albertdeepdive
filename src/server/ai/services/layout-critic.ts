import { z } from "zod";
import { DIMENSIONS, SEVERITIES, type DesignFinding, type Remedy } from "@/lib/design/critic";
import { COMPOSITIONS, IMPORTANCE, isComposition, type BlockRole } from "@/lib/design/roles";

/**
 * The critic that looks.
 *
 * §34 of the design brief, and the reason the whole engine can be trusted: a design system that
 * never sees its own output is a system that believes its own arithmetic. Measurements already say
 * whether a page overflows; only looking says that the photograph is cropped through somebody's
 * chin, that three spreads in a row read as the same spread, or that an issue which measures
 * perfectly looks like software made it.
 *
 * It runs directly against the vision model rather than through the text pipeline, because it sends
 * pictures — and it answers `null` rather than throwing when no model is configured, because an
 * edition with no critique is still an edition and the measurable findings still stand.
 *
 * The schema is the boundary. The model may name a page or a block *from the list it was given*, and
 * may propose one of the changes the engine knows how to make. It cannot name a colour, a size, a
 * font or a position, because there are no fields for them — the same discipline that keeps the
 * design director from art-directing by adjective.
 */

export const layoutCritiqueSchema = z.object({
  /** The one-word answer to §101: could an excellent editorial designer have made this? */
  verdict: z.enum(["excellent", "competent", "generic", "broken"]),
  /** What an art director would say first, in the editor's language rather than the system's. */
  summary: z.string().min(10).max(500),
  findings: z
    .array(
      z.object({
        dimension: z.enum(DIMENSIONS),
        severity: z.enum(SEVERITIES),
        /** A page number from the shots, or a block id from the list. Anything else is dropped. */
        where: z.string().max(80),
        issue: z.string().min(5).max(240),
        /**
         * A change the engine can make, or "none" when it needs a person.
         *
         * Everything here is validated on the way in. `composition` in particular is meant to be
         * one of the names the block's role can be drawn in — and a model asked for a name will
         * sometimes write a sentence instead, so the field is wide enough to hold the sentence and
         * the check that it is a real composition happens afterwards, where it can be refused
         * without failing the whole critique.
         */
        remedy: z.object({
          kind: z.enum(["composition", "importance", "drop", "none"]),
          blockId: z.string().max(80).nullable(),
          composition: z.string().max(240).nullable(),
          importance: z.enum(IMPORTANCE).nullable(),
        }),
      }),
    )
    .max(12),
});
export type LayoutCritique = z.infer<typeof layoutCritiqueSchema>;

export type CritiqueShot = { label: string; png: Buffer };

export type CritiqueInput = {
  shots: CritiqueShot[];
  /** What the publication is trying to be, so "too quiet" is judged against its own intent. */
  intent: string;
  /** The blocks the model may name, with what they are. An id outside this list is invented. */
  blocks: { id: string; role: string; composition: string; importance: string; headline: string | null }[];
  /** What the measurements already found, so the eyes are not spent re-finding it. */
  alreadyKnown: string[];
};

export type CritiqueResult = { critique: LayoutCritique; model: string; inputTokens: number; outputTokens: number };

const SYSTEM = [
  "You are an art director reviewing a publication before it goes to press.",
  "You are looking at real rendered pages, not a description of them. Judge what you can see.",
  "Be specific and unsentimental. 'Could an excellent editorial designer have made this?' is the question.",
  "Name only pages and block ids from the list you are given. Do not invent one.",
  "Say nothing about colours, fonts, sizes or positions in pixels — you have no way to set them, and the system does.",
  "Do not repeat what the measurements already found. You are here for what only looking can catch.",
  "A page that is merely plain is not a defect. Space is a decision. Say so rather than filling it.",
].join(" ");

export async function critiqueLayout(input: CritiqueInput): Promise<CritiqueResult | null> {
  if (!input.shots.length) return null;
  const { getAiProvider } = await import("@/server/ai/run");
  if (getAiProvider().name !== "openai") return null;

  const { integrationConfig } = await import("@/server/integrations/service");
  const { env } = await import("@/server/env");
  const config = await integrationConfig("openai");
  const apiKey = config.apiKey ?? env.OPENAI_API_KEY;
  const proxyManaged = !apiKey || apiKey === "proxy" || apiKey === "proxy-injected";
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: proxyManaged ? "proxy-injected" : apiKey,
    baseURL: config.baseUrl || env.OPENAI_BASE_URL || undefined,
    defaultHeaders: proxyManaged ? { Authorization: null } : undefined,
    maxRetries: 1,
    timeout: 120_000,
  });
  const { toStrictJsonSchema } = await import("@/server/ai/json-schema");

  const content: ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "low" | "high" } })[] = [];
  content.push({ type: "text", text: `What this publication is trying to be: ${input.intent}` });
  for (const shot of input.shots) {
    content.push({ type: "text", text: shot.label });
    content.push({ type: "image_url", image_url: { url: `data:image/png;base64,${shot.png.toString("base64")}`, detail: "high" } });
  }
  content.push({
    type: "text",
    text: [
      "Blocks you may name:",
      input.blocks.map((block) => `${block.id} — ${block.role} drawn as ${block.composition}, set as ${block.importance}${block.headline ? `: “${block.headline}”` : ""}`).join("\n"),
      "",
      "Compositions each role may be drawn in. If you propose one, write its name exactly as it appears here and nothing else:",
      Object.entries(COMPOSITIONS)
        .filter(([role]) => input.blocks.some((block) => block.role === role))
        .map(([role, list]) => `${role}: ${list.join(", ")}`)
        .join("\n"),
      "",
      input.alreadyKnown.length ? `Already found by measurement, do not repeat:\n${input.alreadyKnown.join("\n")}` : "Nothing was found by measurement.",
    ].join("\n"),
  });

  const completion = await client.chat.completions.create({
    model: config.modelStrong || env.AI_MODEL_STRONG,
    temperature: 0,
    max_completion_tokens: 1400,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content },
    ],
    response_format: { type: "json_schema", json_schema: { name: "layout_critique", schema: toStrictJsonSchema(layoutCritiqueSchema), strict: true } },
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) return null;
  // A truncated answer is not a critique. Parsing it is the one place this can throw, and an
  // exception here would take down a refinement round over something that is only an opinion.
  const parsed = safeJson(raw);
  if (!parsed.success) return null;
  return { critique: parsed.data, model: completion.model, inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 };
}

/**
 * The critique, turned into findings the engine can act on.
 *
 * Everything the model said is checked against what exists: a block id it invented is dropped, a
 * composition the role cannot be drawn in becomes no remedy rather than a broken page, and a page
 * number nobody rendered is forgotten. What survives is a finding exactly like a measured one,
 * marked as seen — because the loop should not care which half of the critic found something.
 */
export function seenFindings(critique: LayoutCritique, known: { blockIds: Set<string>; roleOf: Map<string, string>; pages: Set<number> }): DesignFinding[] {
  const out: DesignFinding[] = [];
  for (const [index, item] of critique.findings.entries()) {
    const blockId = known.blockIds.has(item.remedy.blockId ?? "") ? item.remedy.blockId : known.blockIds.has(item.where) ? item.where : null;
    const page = pageOf(item.where, known.pages);
    if (!blockId && page === null) continue; // it is about nothing that exists

    out.push({
      id: `seen:${item.dimension}:${blockId ?? `page-${page}`}:${index}`,
      dimension: item.dimension,
      severity: item.severity,
      issue: item.issue,
      remedy: remedyOf(item.remedy, blockId, known.roleOf),
      blockId,
      surfaceId: null,
      page,
      source: "seen",
      evidence: {},
    });
  }
  return out;
}

function safeJson(raw: string): { success: true; data: LayoutCritique } | { success: false } {
  try {
    const parsed = layoutCritiqueSchema.safeParse(JSON.parse(raw));
    return parsed.success ? { success: true, data: parsed.data } : { success: false };
  } catch {
    return { success: false };
  }
}

function pageOf(where: string, pages: Set<number>): number | null {
  const match = /(\d{1,3})/.exec(where);
  if (!match) return null;
  const number = Number(match[1]);
  return pages.has(number) ? number : null;
}

function remedyOf(proposed: LayoutCritique["findings"][number]["remedy"], blockId: string | null, roleOf: Map<string, string>): Remedy {
  if (!blockId || proposed.kind === "none") return { kind: "none" };
  const role = roleOf.get(blockId);
  switch (proposed.kind) {
    case "composition":
      // A composition the role cannot be drawn in is not a suggestion, it is a broken page.
      return role && proposed.composition && isComposition(role as BlockRole, proposed.composition) ? { kind: "composition", blockId, to: proposed.composition } : { kind: "none" };
    case "importance":
      return proposed.importance ? { kind: "importance", blockId, to: proposed.importance } : { kind: "none" };
    case "drop":
      return { kind: "drop", blockId };
    default:
      return { kind: "none" };
  }
}
