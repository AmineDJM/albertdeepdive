/** Version label sequencing for publication versions (pure, unit-tested). */

export const PUBLICATION_KINDS = ["DRAFT", "EDITORIAL_REVIEW", "FINAL_REVIEW", "PUBLISHED"] as const;
export type PublicationKind = (typeof PUBLICATION_KINDS)[number];

export type ExistingVersion = { kind: PublicationKind | string; sequence: number; label: string };

/**
 * DRAFT / EDITORIAL_REVIEW / FINAL_REVIEW versions are numbered v0.<sequence> (sequence is global for
 * the edition, so labels never collide); PUBLISHED versions are v<major>.0 where major is the number
 * of published versions + 1.
 */
export function nextVersionLabel(
  kind: PublicationKind,
  existing: readonly ExistingVersion[],
): { label: string; sequence: number } {
  const sequence = existing.reduce((max, v) => Math.max(max, v.sequence), 0) + 1;
  if (kind === "PUBLISHED") {
    const major = existing.filter((v) => v.kind === "PUBLISHED").length + 1;
    return { label: `v${major}.0`, sequence };
  }
  return { label: `v0.${sequence}`, sequence };
}

/** Sort key so that "v1.0" > "v0.12" > "v0.2". */
export function compareLabels(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
