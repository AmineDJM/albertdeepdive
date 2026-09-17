import "@/server/load-env";
import { writeFileSync } from "node:fs";
import { desc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { editions } from "@/server/db/schema";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { auditDocumentLayout } from "@/server/publication/layout-audit";
import { formatQualityTable } from "@/server/publication/page-quality";

/**
 * Grades an edition's printed layout without exporting anything.
 *
 *   pnpm layout:audit                 # the most recent edition
 *   pnpm layout:audit <editionId>     # a specific one
 *   pnpm layout:audit <editionId> out.json
 *
 * Exits non-zero when a page would not be signed off (overflow, clipped, blank, sparse
 * continuation, accidentally empty), so it can gate a build.
 */
async function main() {
  const editionId =
    process.argv[2] ||
    (await db.query.editions.findFirst({ orderBy: [desc(editions.year), desc(editions.month)], columns: { id: true } }))?.id;
  if (!editionId) throw new Error("No edition found. Pass an edition id.");

  const doc = await buildEditionDocument(editionId, { versionLabel: "audit", includeUnapproved: true });
  console.log(`[audit] ${doc.meta.issueLabel} — ${doc.meta.title} (${doc.pages.length} planned pages, ${doc.articles.length} articles)`);

  const { layout, quality, durationMs } = await auditDocumentLayout(doc);

  console.log("");
  console.log(formatQualityTable(quality));
  console.log("");
  console.log(
    `[layout] ${layout.pages} pages (planned ${layout.plannedPages}) · +${layout.continuationPagesAdded} continuation · ` +
      `${layout.blocksMoved} blocks moved · ${layout.paragraphsSplit} splits · ${layout.copyfitFlows} copyfit · ${layout.rounds} rounds · ${durationMs} ms`,
  );
  if (layout.remainingOverflow.length) {
    console.log(`[layout] UNRESOLVED OVERFLOW on pages: ${[...new Set(layout.remainingOverflow.map((o) => o.page))].join(", ")}`);
  }
  const worst = [...quality.pages].sort((a, b) => a.usableAreaOccupancy - b.usableAreaOccupancy).slice(0, 5);
  console.log(`[density] thinnest pages: ${worst.map((p) => `p${p.pageNumber} ${Math.round(p.usableAreaOccupancy * 100)}%`).join(" · ")}`);
  if (Object.keys(quality.issueCounts).length) {
    console.log(`[issues] ${Object.entries(quality.issueCounts).map(([k, v]) => `${k}×${v}`).join(" · ")}`);
  }

  const out = process.argv[3];
  if (out) {
    writeFileSync(out, JSON.stringify({ editionId, layout, quality }, null, 2));
    console.log(`[audit] written to ${out}`);
  }

  if (!quality.ok) {
    console.error(`\n[audit] FAILED — ${quality.hardFailures} page(s) would not be signed off: ${quality.failingPages.join(", ")}`);
    process.exit(1);
  }
  console.log(`\n[audit] PASSED — every page is printable (avg occupancy ${Math.round(quality.averageOccupancy * 100)} %).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[audit] failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
