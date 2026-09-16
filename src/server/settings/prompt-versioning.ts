/**
 * Pure helpers for the prompt manager (versioning, template variables, diff summaries).
 */

export type PromptVersionLike = { version: number; isActive: boolean };

/** Extracts the distinct `{{variable}}` names used by a set of templates, in order of appearance. */
export function extractTemplateVariables(...templates: string[]): string[] {
  const out: string[] = [];
  for (const template of templates) {
    for (const match of template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
      const name = match[1];
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}

export function nextPromptVersion(versions: readonly number[]): number {
  return versions.length ? Math.max(...versions) + 1 : 1;
}

/** Returns the rows with exactly one active version (the requested one). */
export function applyActivation<T extends PromptVersionLike>(rows: readonly T[], version: number): T[] {
  if (!rows.some((r) => r.version === version)) throw new Error(`Version ${version} does not exist`);
  return rows.map((r) => ({ ...r, isActive: r.version === version }));
}

export function activeVersion<T extends PromptVersionLike>(rows: readonly T[]): T | null {
  const active = rows.filter((r) => r.isActive).sort((a, b) => b.version - a.version);
  return active[0] ?? null;
}

export type PromptFields = {
  systemPrompt: string;
  userPrompt: string;
  modelTier: "FAST" | "STRONG";
  temperature: number;
  maxOutputTokens: number;
};

/** One-line human summary of what changed between two versions. */
export function diffSummary(prev: PromptFields | null, next: PromptFields): string {
  if (!prev) return "Initial version";
  const parts: string[] = [];
  const delta = (a: string, b: string) => {
    const d = b.length - a.length;
    return d === 0 ? "rewritten" : `${d > 0 ? "+" : "−"}${Math.abs(d)} chars`;
  };
  if (prev.systemPrompt !== next.systemPrompt) parts.push(`system ${delta(prev.systemPrompt, next.systemPrompt)}`);
  if (prev.userPrompt !== next.userPrompt) parts.push(`user ${delta(prev.userPrompt, next.userPrompt)}`);
  if (prev.modelTier !== next.modelTier) parts.push(`${prev.modelTier} → ${next.modelTier}`);
  if (prev.temperature !== next.temperature) parts.push(`temperature ${prev.temperature} → ${next.temperature}`);
  if (prev.maxOutputTokens !== next.maxOutputTokens) parts.push(`max tokens ${prev.maxOutputTokens} → ${next.maxOutputTokens}`);
  return parts.length ? parts.join(", ") : "No changes";
}

/** Sample values used by "Test prompt" so the rendered template reads like a real call. */
const SAMPLE_VARIABLES: Record<string, string> = {
  storyType: "BUSINESS_DEEP_DIVE",
  storyTypes: "BUSINESS_DEEP_DIVE, STUDENT_PROJECT, INTERVIEW_PROFILE, SCHOOL_NEWS, CAMPUS_LIFE",
  sectionSlugs: "spotlight, projects, bdd, actus, campus-life, events",
  declaredType: "BUSINESS_DEEP_DIVE",
  campus: "Paris",
  campuses: "Paris",
  title: "Carrefour – B2 Paris",
  currentHeadline: "Pet food, two LightGBM models and a +0.4% sales uplift per shop",
  headline: "Pet food, two LightGBM models and a +0.4% sales uplift per shop",
  description:
    "From 17 March to 4 April, B2 Paris students worked on Carrefour's pet-food assortment. The winning team trained a LightGBMRanker and a LightGBMRegressor to recommend shop-level assortments.",
  peopleInvolved: "Sacha Nardoux (winner), Lucile Garzon (jury)",
  organisationsInvolved: "Carrefour",
  whyItMatters: "It is the first BDD where a ranking model beat the historical assortment on every test shop.",
  quotes: '"We spent the first week just understanding the shop IDs." — Sacha Nardoux',
  extra: "cohort: B2 Paris; dates: 17 March – 4 April",
  text: "From 17 March to 4 April, the B2 Paris cohort worked with Carrefour on pet-food assortment optimisation. The winning team (Sacha Nardoux, Jack Pastore) used LightGBM rankers.",
  submissions: "[S1] Carrefour BDD — winners announced on 4 April.\n[S2] Photos of the final pitch with the jury.",
  summary: "Second-year students optimised Carrefour's pet-food assortment with LightGBM models.",
  sourceCount: "3",
  mediaCount: "4",
  mediaNotes: "team photo, dashboard screenshot, company logo",
  quoteCount: "2",
  factSheet: "F1: The project ran from 17 March to 4 April [VERIFIED_BY_SUBMISSION]\nF2: The winning team used LightGBMRanker [STATED_BY_CONTRIBUTOR]",
  facts: "F1: The project ran from 17 March to 4 April [VERIFIED_BY_SUBMISSION]\nF2: The winning team used LightGBMRanker and LightGBMRegressor [STATED_BY_CONTRIBUTOR]\nF3: Sales uplift of +0.4% per shop on the test set [STATED_BY_CONTRIBUTOR]",
  targetLength: "MEDIUM",
  targetWords: "260–520",
  editorNotes: "Name the jury members in the last paragraph.",
  count: "5",
  body: "THE CASE\nCarrefour asked the cohort to rethink the pet-food shelf…",
  language: "en",
  sections: "spotlight, projects, bdd, actus, campus-life",
  context: "Winning team photo taken after the final pitch at the Paris campus.",
};

export function sampleVariables(names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) out[name] = SAMPLE_VARIABLES[name] ?? `<${name}>`;
  return out;
}
