import type { ImageEditPlan, ImageOperation, ImageTask, ReferenceRole, Sensitivity } from "./types";

/**
 * From a sentence to a plan.
 *
 * "Keep everything identical but replace the phone with our product" has to become: a localized
 * edit, high sensitivity, change ["replace the phone with the product"], preserve ["everything
 * else"], references [current_version, product_reference, original_master]. A model writes the
 * plan when one is connected; these rules write it without one, and set the floor either way —
 * a model may raise the sensitivity of an edit to a person's face, never lower it.
 */

export type PlanContext = {
  isEdit: boolean;
  /** What is known about the picture being edited, from its description and tags. */
  subject: { people: boolean; product: boolean; logo: boolean; architecture: boolean; text: boolean };
  /** Whether the person asked for illustration, vector or a poster explicitly. */
  wantsVector?: boolean;
  /** -1 preserve more … +1 change more, from the Advanced panel. */
  latitude?: number;
  /** Whether references of these roles are on offer. */
  offered: ReferenceRole[];
};

const PEOPLE = /\b(person|people|face|founder|employee|team|portrait|ceo|student|woman|man|speaker|smile|hair|skin|hand|eyes|him|her|them|everyone|somebody|person on the)\b/i;
const PRODUCT = /\b(product|packaging|bottle|phone|laptop|device|box|label|can|shoe|bag|our product|screen|logo|brand|badge)\b/i;
const ARCHITECTURE = /\b(building|architecture|facade|campus|headquarters|office|interior|room|lobby|storefront)\b/i;
const LOGO = /\b(logo|wordmark|brandmark|emblem)\b/i;
const ONLY = /\b(only|just|nothing else|everything else|keep everything|identical|exactly|do not change|don't change|without changing|leave the rest|except)\b/i;
const REMOVE = /\b(remove|erase|delete|take out|get rid of|without the)\b/i;
const REPLACE = /\b(replace|swap|change the|put .* instead|turn the .* into)\b/i;
const BACKGROUND = /\b(background|backdrop|behind|setting|environment|sky|scene behind)\b/i;
/** A new setting is a real change; the sky's colour is a mood, and stays free. */
const SETTING = /\b(background|backdrop|behind|setting|environment|scene behind)\b/i;
const MOOD = /\b(mood|atmosphere|premium|warmer|cooler|lighting|light|tone|colour|color|grade|contrast|brighter|darker|vibe|feel)\b/i;
const ILLUSTRATION = /\b(illustration|illustrated|icon|icons|vector|svg|flat|line art|diagram|pattern|symbol|pictogram|geometric)\b/i;
const TYPOGRAPHY = /\b(poster|typography|headline|lettering|type|text|title|banner|flyer|cover with|campaign graphic|ad visual)\b/i;
const REALISTIC = /\b(photo|photograph|realistic|photoreal|portrait|shot|standing|outside|indoors|scene|lifestyle|studio|product photo)\b/i;
const ABSTRACT = /\b(abstract|gradient|texture|background field|ambient)\b/i;

function lines(text: string): string[] {
  return text
    .split(/(?:\band\b|[;,.]|\n)+/i)
    .map((piece) => piece.trim().replace(/^(please|then|also)\s+/i, ""))
    .filter((piece) => piece.length > 2)
    .slice(0, 6);
}

export function inferTask(instruction: string, context: PlanContext): ImageTask {
  const text = instruction;
  if (context.isEdit) return "precise_edit";
  if (context.wantsVector || ILLUSTRATION.test(text)) return "illustration";
  if (TYPOGRAPHY.test(text)) return "typography";
  if (ABSTRACT.test(text) && !REALISTIC.test(text)) return "abstract";
  return "realistic_scene";
}

export function inferOperation(instruction: string, context: PlanContext): ImageOperation {
  if (!context.isEdit) return "generate";
  if (ONLY.test(instruction) || REMOVE.test(instruction) || (REPLACE.test(instruction) && !BACKGROUND.test(instruction))) return "localized_edit";
  return "global_edit";
}

/**
 * How careful to be.
 *
 * HIGH whenever a real person, a product, packaging, a logo or a building is in the picture or
 * in the ask, and whenever the ask says "only" — a small change with everything else identical is
 * the hardest edit there is. MEDIUM for furniture, environments and clothing. LOW for mood, light
 * and sky. "Change more" from the Advanced panel may lower one step, never below what the subject
 * demands.
 */
export function classifySensitivity(instruction: string, context: PlanContext): Sensitivity {
  const text = instruction;
  const subject = context.subject;
  let level: Sensitivity = "LOW";
  if (context.isEdit && (subject.people || subject.product || subject.logo || subject.architecture || PEOPLE.test(text) || PRODUCT.test(text) || LOGO.test(text) || ARCHITECTURE.test(text) || ONLY.test(text))) level = "HIGH";
  else if (context.isEdit && (REPLACE.test(text) || REMOVE.test(text) || SETTING.test(text) || /\b(clothes|clothing|outfit|furniture|table|chair|desk|wall|floor)\b/i.test(text))) level = "MEDIUM";
  else if (!context.isEdit && (PEOPLE.test(text) || PRODUCT.test(text) || LOGO.test(text))) level = "MEDIUM";
  if ((context.latitude ?? 0) < -0.5 && level !== "HIGH") level = level === "LOW" ? "MEDIUM" : "HIGH";
  return level;
}

const RANK: Record<Sensitivity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function atLeast(a: Sensitivity, b: Sensitivity): Sensitivity {
  return RANK[a] >= RANK[b] ? a : b;
}

function preserveFor(instruction: string, context: PlanContext, sensitivity: Sensitivity): string[] {
  const keep = new Set<string>();
  if (context.isEdit) {
    keep.add("overall composition");
    keep.add("camera angle");
    if (context.subject.people || PEOPLE.test(instruction)) for (const item of ["facial identity", "skin tone", "age", "hair", "pose", "anatomy"]) keep.add(item);
    if (context.subject.product || PRODUCT.test(instruction)) for (const item of ["product geometry", "product proportions", "product colours", "labels and buttons"]) keep.add(item);
    if (context.subject.logo || LOGO.test(instruction)) keep.add("logo exactly as it is");
    if (context.subject.architecture || ARCHITECTURE.test(instruction)) keep.add("architecture and perspective");
    if (sensitivity === "HIGH") keep.add("everything not named in the change");
    if (!BACKGROUND.test(instruction) && !MOOD.test(instruction)) keep.add("lighting");
  }
  return [...keep];
}

function referencesFor(context: PlanContext, sensitivity: Sensitivity, instruction: string): ReferenceRole[] {
  const wanted: ReferenceRole[] = [];
  const offered = new Set(context.offered);
  if (context.isEdit) {
    wanted.push("current_version");
    if (sensitivity !== "LOW" && offered.has("original_master")) wanted.push("original_master");
    if ((context.subject.people || PEOPLE.test(instruction)) && offered.has("identity_reference")) wanted.push("identity_reference");
    if ((context.subject.product || PRODUCT.test(instruction)) && offered.has("product_reference")) wanted.push("product_reference");
    if (LOGO.test(instruction) && offered.has("brand_reference")) wanted.push("brand_reference");
  } else {
    if (PEOPLE.test(instruction) && offered.has("identity_reference")) wanted.push("identity_reference");
    if (PRODUCT.test(instruction) && offered.has("product_reference")) wanted.push("product_reference");
    if (offered.has("style_reference")) wanted.push("style_reference");
    if (offered.has("composition_reference")) wanted.push("composition_reference");
  }
  return [...new Set(wanted)];
}

/** The plan the rules alone produce. A model's plan is checked against it. */
export function heuristicPlan(instruction: string, context: PlanContext): ImageEditPlan {
  const task = inferTask(instruction, context);
  const operation = inferOperation(instruction, context);
  const sensitivity = classifySensitivity(instruction, context);
  const change = lines(instruction);
  const preserve = preserveFor(instruction, context, sensitivity);
  const output = task === "illustration" && (context.wantsVector || /\b(vector|svg|icon|icons)\b/i.test(instruction)) ? "vector" : "raster";
  const plan: ImageEditPlan = { operation, task, change: change.length ? change : [instruction.trim()], preserve, references: referencesFor(context, sensitivity, instruction), sensitivity, region: null, output, prompt: "", source: "local" };
  return { ...plan, prompt: promptFor(plan, { instruction }) };
}

/**
 * A model's plan, held to the rules' floor.
 *
 * The model may see more than the rules — that "the plant" is on the left, that the ask is really
 * about the lighting — and everything it adds is kept. What it may not do is decide a founder's
 * face is a low-sensitivity subject, or drop the original from the references of a high one.
 */
export function reconcilePlans(model: Partial<ImageEditPlan>, floor: ImageEditPlan, context: PlanContext): ImageEditPlan {
  const sensitivity = atLeast(model.sensitivity ?? "LOW", floor.sensitivity);
  const references = [...new Set([...(model.references ?? []), ...floor.references])].filter((role) => context.offered.includes(role) || role === "current_version");
  const preserve = [...new Set([...(model.preserve ?? []), ...floor.preserve])];
  const change = model.change?.length ? model.change : floor.change;
  const operation = context.isEdit ? (model.operation && model.operation !== "generate" ? model.operation : floor.operation) : "generate";
  const region = model.region && isRegion(model.region) ? model.region : null;
  const plan: ImageEditPlan = { operation, task: model.task ?? floor.task, change, preserve, references, sensitivity, region, output: model.output ?? floor.output, prompt: "", source: "model" };
  return { ...plan, prompt: model.prompt?.trim() ? strengthen(model.prompt.trim(), plan) : promptFor(plan, { instruction: change.join(". ") }) };
}

function isRegion(value: unknown): value is ImageEditPlan["region"] {
  if (!value || typeof value !== "object") return false;
  const region = value as Record<string, unknown>;
  return ["x", "y", "width", "height"].every((key) => typeof region[key] === "number" && (region[key] as number) >= 0 && (region[key] as number) <= 1) && (region.width as number) > 0 && (region.height as number) > 0;
}

/** The sentences a high-sensitivity edit always ends with, whatever the model wrote. */
export function strengthen(prompt: string, plan: Pick<ImageEditPlan, "sensitivity" | "preserve" | "operation">): string {
  if (plan.sensitivity !== "HIGH" || !plan.preserve.length) return prompt;
  const guard = `Keep exactly as in the reference: ${plan.preserve.join(", ")}. Change nothing that was not asked for.${plan.operation === "localized_edit" ? " Every pixel outside the requested change stays identical." : ""}`;
  return prompt.includes(guard) ? prompt : `${prompt}\n\n${guard}`;
}

/**
 * The prompt, from the plan.
 *
 * Written the same way every time: the ask, then what to protect, then the constraints that apply
 * to every picture Briefly makes — no text, no logos invented, nobody real invented. The renderer
 * draws the words and places the logo; a model that puts either in the picture makes work nobody
 * can correct.
 */
export function promptFor(plan: Omit<ImageEditPlan, "prompt" | "source">, input: { instruction: string; brand?: { palette?: string[]; photographyStyle?: string | null; avoid?: string[] } | null }): string {
  const parts: string[] = [];
  if (plan.operation === "generate") {
    parts.push(plan.change.join(". ") + ".");
    if (plan.task === "realistic_scene") parts.push("Photographic, natural light, believable proportions, no extra limbs, no warped hands, no invented brand marks.");
    if (plan.task === "illustration") parts.push(plan.output === "vector" ? "Clean vector illustration, flat shapes, consistent stroke, transparent or plain background." : "Illustration with a consistent visual system.");
    if (plan.task === "typography") parts.push("Graphic-design composition. Any lettering must be placeholder shapes only: the final words are set by the publisher, never by the picture.");
    if (plan.task === "abstract") parts.push("Abstract field: no objects, no people, no text, no logos.");
  } else {
    parts.push(plan.operation === "localized_edit" ? `Edit only this: ${plan.change.join("; ")}.` : `Edit the picture: ${plan.change.join("; ")}.`);
    if (plan.preserve.length) parts.push(`Keep unchanged: ${plan.preserve.join(", ")}.`);
    if (plan.region) parts.push("The change is confined to the marked area; everything outside it stays identical.");
  }
  if (input.brand?.palette?.length && plan.task !== "realistic_scene") parts.push(`Colours drawn from: ${input.brand.palette.join(", ")}.`);
  if (input.brand?.photographyStyle && plan.task === "realistic_scene") parts.push(`Photography style: ${input.brand.photographyStyle}.`);
  if (input.brand?.avoid?.length) parts.push(`Avoid: ${input.brand.avoid.join(", ")}.`);
  parts.push("No written words, no watermark, no signature, no logo unless one is supplied as a reference.");
  return strengthen(parts.join(" "), plan);
}

/**
 * Everything a line of edits asked for, folded into one specification.
 *
 * For a sensitive subject, the fifth edit is made from the master and this — not from the fourth
 * raster — because each pass through a model costs the founder's face a little of itself, and
 * five passes is a different person.
 */
export function accumulateSpec(plans: (ImageEditPlan | null)[]): { change: string[]; preserve: string[]; sensitivity: Sensitivity } {
  const change: string[] = [];
  const preserve = new Set<string>();
  let sensitivity: Sensitivity = "LOW";
  for (const plan of plans) {
    if (!plan) continue;
    for (const line of plan.change) if (!change.includes(line)) change.push(line);
    for (const line of plan.preserve) preserve.add(line);
    sensitivity = atLeast(sensitivity, plan.sensitivity);
  }
  return { change, preserve: [...preserve], sensitivity };
}

/** After this many edits in a row on a sensitive subject, the next one starts again from the master. */
export const REGENERATE_AFTER = 3;

export function shouldRegenerate(sensitivity: Sensitivity, editsSinceMaster: number): boolean {
  return sensitivity === "HIGH" && editsSinceMaster >= REGENERATE_AFTER;
}
