/**
 * The vocabulary of pictures made and edited.
 *
 * A person types a sentence. Everything below turns that sentence into a plan a model can be held
 * to — what changes, what must not, how carefully — and the plan, not the sentence, chooses the
 * model. Nothing here names a provider to the person.
 */

export const IMAGE_TASKS = ["realistic_scene", "precise_edit", "illustration", "typography", "abstract"] as const;
export type ImageTask = (typeof IMAGE_TASKS)[number];

export const IMAGE_OPERATIONS = ["generate", "localized_edit", "global_edit", "regenerate"] as const;
export type ImageOperation = (typeof IMAGE_OPERATIONS)[number];

export const SENSITIVITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const REFERENCE_ROLES = ["identity_reference", "product_reference", "style_reference", "composition_reference", "brand_reference", "original_master", "current_version"] as const;
export type ReferenceRole = (typeof REFERENCE_ROLES)[number];

export const CAPABILITIES = ["photorealism", "precise_edit", "multi_reference", "identity_preservation", "vector", "typography", "background_edit", "inpainting", "style_reference", "illustration"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** A rectangle of the picture, as fractions of its width and height. */
export type Region = { x: number; y: number; width: number; height: number };

export type ImageEditPlan = {
  operation: ImageOperation;
  task: ImageTask;
  /** What the person asked to change, as short imperative lines. */
  change: string[];
  /** What must come out identical. */
  preserve: string[];
  /** Which references to send, by role. Only what helps. */
  references: ReferenceRole[];
  sensitivity: Sensitivity;
  /** Where the change is, when it is somewhere in particular. */
  region: Region | null;
  output: "raster" | "vector";
  /** The prompt the model is given, written from the plan. */
  prompt: string;
  /** How the plan was made. */
  source: "model" | "local";
};

export type ImageQa = {
  /** 0–1: how usable the check believes the picture is. */
  score: number;
  verdict: "pass" | "retry" | "fail";
  /** How much of the picture changed against the previous version, 0–1; null for a fresh generation. */
  change: number | null;
  adherence: number | null;
  fidelity: number | null;
  issues: string[];
  method: "heuristic" | "vision";
  checkedAt: string;
};

/** What a person may adjust under "Advanced", in plain words. */
export type ImageAdvanced = {
  /** -1 preserve more … +1 change more. */
  latitude: number;
  variations: 1 | 2 | 3 | 4;
  /** For generation: how photographic the result should look, 0–1. */
  realism: number | null;
};
