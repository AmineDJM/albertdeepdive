import { z } from "zod";

const UNSUPPORTED = new Set(["minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "format", "default", "minItems", "maxItems", "$schema", "examples", "uniqueItems", "multipleOf"]);

/**
 * Converts a zod schema to a JSON schema compatible with OpenAI structured outputs (strict mode):
 * every object gets `additionalProperties: false` and all properties are required; unsupported
 * validation keywords are stripped (zod validation still runs on the parsed output).
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" }) as Record<string, unknown>;
  return strictify(raw) as Record<string, unknown>;
}

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== "object") return node;
  const obj = { ...(node as Record<string, unknown>) };
  for (const key of Object.keys(obj)) {
    if (UNSUPPORTED.has(key)) delete obj[key];
  }
  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    const props = obj.properties as Record<string, unknown>;
    /*
     * Strict mode requires every property, so an optional one has to be sent as `null`.
     *
     * This conversion used to make everything required and stop there. The model, obliged to emit
     * something for `body`, `figure`, `attribution`, `items` and `mediaId` on every frame, filled
     * them with empty strings and empty arrays — which the zod schema, still enforcing `min(1)` and
     * `uuid()`, rejected on every attempt. So the Art Director never once succeeded against a real
     * model; every pack in production fell back to the local brief, and nothing said so.
     *
     * The documented shape is: keep the property required, and widen its type to admit null. Zod
     * then needs to accept the null it asked for, which `scrubEmpties` does before validation.
     */
    const wasRequired = new Set(Array.isArray(obj.required) ? (obj.required as string[]) : []);
    obj.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, wasRequired.has(k) ? strictify(v) : nullable(strictify(v))]),
    );
    obj.required = Object.keys(props);
    obj.additionalProperties = false;
  }
  if (obj.items) obj.items = strictify(obj.items);
  for (const combinator of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(obj[combinator])) obj[combinator] = (obj[combinator] as unknown[]).map(strictify);
  }
  if (obj.$defs && typeof obj.$defs === "object") {
    obj.$defs = Object.fromEntries(Object.entries(obj.$defs as Record<string, unknown>).map(([k, v]) => [k, strictify(v)]));
  }
  if (obj.definitions && typeof obj.definitions === "object") {
    obj.definitions = Object.fromEntries(Object.entries(obj.definitions as Record<string, unknown>).map(([k, v]) => [k, strictify(v)]));
  }
  return obj;
}

/** A schema that also admits null, in the form strict mode accepts. */
function nullable(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return { anyOf: [schema, { type: "null" }] };
  const obj = schema as Record<string, unknown>;
  if (Array.isArray(obj.anyOf)) {
    if ((obj.anyOf as Record<string, unknown>[]).some((m) => m?.type === "null")) return obj;
    return { ...obj, anyOf: [...(obj.anyOf as unknown[]), { type: "null" }] };
  }
  return { anyOf: [obj, { type: "null" }] };
}

/**
 * Treat an optional field the model filled with nothing as absent.
 *
 * Told it may send null, a model sends null; sometimes it still sends "" or []. For a field the
 * schema marks optional, all three mean the same thing — there is no value — and the honest
 * treatment is to drop the key so `.optional()` sees undefined. Required fields are left exactly as
 * they came, so a required empty string still fails validation with its own message rather than
 * being quietly promoted to "missing".
 *
 * Walks the zod schema alongside the value so it knows which fields are optional; a value-only
 * scrub cannot tell an optional `[]` from a required, legitimately empty `hashtags: []`.
 */
export function scrubEmpties(schema: z.ZodType, value: unknown): unknown {
  const def = (schema as unknown as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
  if (!def) return value;
  const type = def.type as string | undefined;

  if (type === "optional" || type === "nullable" || type === "default" || type === "nonoptional" || type === "readonly" || type === "catch") {
    return scrubEmpties(def.innerType as z.ZodType, value);
  }
  if (type === "pipe") return scrubEmpties((def.in as z.ZodType) ?? (def.out as z.ZodType), value);
  if (type === "array" && Array.isArray(value)) {
    return value.map((item) => scrubEmpties(def.element as z.ZodType, item));
  }
  if (type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const shape = def.shape as Record<string, z.ZodType>;
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const field = shape?.[key];
      if (field && isOptional(field) && isEmpty(raw)) continue;
      out[key] = field ? scrubEmpties(field, raw) : raw;
    }
    return out;
  }
  return value;
}

function isOptional(schema: z.ZodType): boolean {
  const def = (schema as unknown as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
  if (!def) return false;
  const type = def.type as string | undefined;
  if (type === "optional" || type === "default") return true;
  if (type === "nullable" || type === "readonly" || type === "catch") return isOptional(def.innerType as z.ZodType);
  return false;
}

const isEmpty = (value: unknown) => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
