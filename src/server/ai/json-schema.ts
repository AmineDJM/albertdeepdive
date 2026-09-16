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
    obj.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, strictify(v)]));
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
