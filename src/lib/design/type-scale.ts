import { FAMILIES, PERSONALITIES, type FamilyKey, type PersonalityKey, type RoleStyle } from "@/lib/brand/typography";
import type { ResolvedDirection } from "./identity";
import type { OutputMedium } from "./roles";
import { TYPE_ROLES, type TypeRole } from "./model";

/**
 * The publication's type scale, generated rather than hardcoded.
 *
 * §9 of the design brief: do not ship the same scale for every brand. A scale is the relationship
 * between a headline and the text under it, and that relationship is the difference between a
 * quarterly report and a music magazine. It comes from three things — the ratio the direction
 * resolved (expressive voices step harder), the font's own proportions, and the medium, because
 * 11pt on paper and 11px on a screen are not the same size to a reader.
 *
 * The other half of §7: headline typography is not body typography enlarged. A display role gets
 * its own family, weight, tracking and leading, and tracking tightens as size grows because type
 * set at 60pt with the tracking of 11pt text looks loose — which is the single most common way
 * software-made pages announce themselves.
 */

/** The reference size each medium's scale is built around, in that medium's own units. */
export const MEDIUM_BASE: Record<OutputMedium, { base: number; unit: string; minBody: number }> = {
  // 10.5pt is a printed page's comfortable minimum for continuous reading.
  print: { base: 10.5, unit: "pt", minBody: 9 },
  web: { base: 17, unit: "px", minBody: 15 },
  // Email is read on a phone, in a hurry, often outdoors.
  email: { base: 16, unit: "px", minBody: 14 },
  docx: { base: 11, unit: "pt", minBody: 10 },
  social: { base: 32, unit: "px", minBody: 24 },
};

/** Where each role sits on the scale, in steps from the body. */
const STEPS: Record<TypeRole, number> = {
  "display-xl": 6,
  "display-l": 4.5,
  headline: 3,
  subheadline: 2,
  deck: 1,
  body: 0,
  "body-small": -0.7,
  caption: -1.2,
  metadata: -1.5,
  label: -1.6,
};

/** Which of the brand's four faces carries each role. */
const FACE: Record<TypeRole, keyof typeof PERSONALITIES.editorial & ("display" | "text" | "label" | "figure")> = {
  "display-xl": "display",
  "display-l": "display",
  headline: "display",
  subheadline: "display",
  deck: "text",
  body: "text",
  "body-small": "text",
  caption: "text",
  metadata: "label",
  label: "label",
};

export type TypeStyle = {
  role: TypeRole;
  family: FamilyKey;
  /** The CSS stack, for renderers that link rather than embed. */
  stack: string;
  weight: number;
  /** In the medium's own unit. */
  size: number;
  unit: string;
  /** Em-relative, as the brand's own styles express it. */
  tracking: number;
  leading: number;
  case: RoleStyle["case"];
  /** Optical cap height, for aligning type with rules and picture edges. */
  capHeight: number;
};

export type TypeScale = {
  medium: OutputMedium;
  ratio: number;
  base: number;
  unit: string;
  roles: Record<TypeRole, TypeStyle>;
};

/**
 * Tracking tightens as type grows, and loosens as it shrinks.
 *
 * The rule every typesetter applies by hand and most software ignores. A display face at six steps
 * above the body wants noticeably less letter-spacing than the same face at text size; a caption
 * wants slightly more, because small type loses its counters first.
 */
function trackingFor(base: number, step: number): number {
  if (step >= 3) return base - 0.012 * Math.min(step, 6);
  if (step <= -1) return base + 0.01;
  return base;
}

/**
 * Leading closes as type grows.
 *
 * Long lines of body text need air between them; a two-line headline does not, and leading meant
 * for reading makes a headline look like two separate statements.
 */
function leadingFor(base: number, step: number): number {
  if (step >= 4.5) return Math.max(0.94, base - 0.42);
  if (step >= 3) return Math.max(1, base - 0.34);
  if (step >= 1) return Math.max(1.15, base - 0.18);
  if (step <= -1) return base - 0.06;
  return base;
}

export function buildScale(direction: ResolvedDirection, personality: PersonalityKey, medium: OutputMedium): TypeScale {
  const { base, unit, minBody } = MEDIUM_BASE[medium];
  const faces = PERSONALITIES[personality] ?? PERSONALITIES.editorial;
  // The publication's own ratio, held inside what a scale can be: below 1.12 the roles stop being
  // distinguishable, above 1.55 a headline and its deck belong to different documents.
  const ratio = Math.min(1.55, Math.max(1.12, direction.scaleRatio));

  const roles = {} as Record<TypeRole, TypeStyle>;
  for (const role of TYPE_ROLES) {
    const step = STEPS[role];
    const faceKey = FACE[role];
    const style = faces[faceKey] as RoleStyle;
    const family = FAMILIES[style.family];
    const raw = base * ratio ** step;
    // Body and anything below it is never allowed under the medium's floor. A caption nobody can
    // read is not a caption; it is a decoration that happens to contain words.
    const size = step <= 0 ? Math.max(minBody * (step === 0 ? 1 : 0.92), raw) : raw;
    roles[role] = {
      role,
      family: style.family,
      stack: family.stack,
      weight: style.weight,
      size: Math.round(size * 100) / 100,
      unit,
      tracking: Math.round(trackingFor(style.tracking, step) * 1000) / 1000,
      leading: Math.round(leadingFor(style.leading, step) * 100) / 100,
      case: style.case,
      capHeight: family.capHeight,
    };
  }
  return { medium, ratio, base, unit, roles };
}

/**
 * The same publication, at one medium's size, compared with another's.
 *
 * Used by the cross-format test: a headline must be the *same role* everywhere, and bigger than its
 * deck everywhere, even though the numbers differ. If print's hierarchy survives and email's does
 * not, the two are not the same publication.
 */
export function hierarchyOf(scale: TypeScale): TypeRole[] {
  return [...TYPE_ROLES].sort((a, b) => scale.roles[b].size - scale.roles[a].size);
}

/** Whether a scale actually separates its roles, which is the only thing a scale is for. */
export function isDistinguishable(scale: TypeScale): boolean {
  const order: TypeRole[] = ["display-xl", "display-l", "headline", "subheadline", "deck", "body"];
  for (let i = 1; i < order.length; i += 1) {
    const bigger = scale.roles[order[i - 1]].size;
    const smaller = scale.roles[order[i]].size;
    // Two steps apart in the scale must be visibly apart on the page: 8% is the threshold below
    // which a reader stops seeing a difference and starts seeing an inconsistency.
    if (bigger < smaller * 1.08) return false;
  }
  return true;
}
