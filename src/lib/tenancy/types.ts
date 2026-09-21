/**
 * What kind of organisation a workspace belongs to.
 *
 * The same list is needed by the database enum, by the form that asks, and by the pass that reads
 * a website and has to answer in the platform's own vocabulary. Keeping it here — with no imports
 * — means those three can never drift apart, and that the form's labels live next to the values
 * they label rather than in a component.
 */
export const organizationTypes = ["COMPANY", "SCHOOL", "UNIVERSITY", "ASSOCIATION", "COMMUNITY", "INVESTOR", "MEDIA", "INSTITUTION", "OTHER"] as const;
export type OrganizationType = (typeof organizationTypes)[number];

export const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  COMPANY: "Company",
  SCHOOL: "School",
  UNIVERSITY: "University",
  ASSOCIATION: "Association",
  COMMUNITY: "Community",
  INVESTOR: "Investment firm",
  MEDIA: "Media",
  INSTITUTION: "Institution",
  OTHER: "Other",
};

export function isOrganizationType(value: unknown): value is OrganizationType {
  return typeof value === "string" && (organizationTypes as readonly string[]).includes(value);
}
