/**
 * Sample export: renders the seeded edition (issue N°1) as a DRAFT version, copies the PDF and DOCX
 * to ./exports and verifies both outputs.
 *
 *   pnpm export:sample            (uses DATABASE_URL from .env / the environment)
 */
import "@/server/load-env";
import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { db } from "@/server/db/client";
import { editions, users } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { verifyDocx } from "@/server/publication/docx";
import { createPublicationVersion, getVersion, renderVersion } from "@/server/publication/versions";
import { fileSlug } from "@/lib/publication/text";

async function main() {
  const started = Date.now();
  const edition = await db.query.editions.findFirst({ where: eq(editions.issueNumber, 1) });
  if (!edition) throw new Error("No edition with issue number 1 — run `pnpm db:seed` first.");
  const admin = await db.query.users.findFirst({ where: eq(users.role, "SUPER_ADMIN") });
  console.log(`Edition: ${edition.title} (${edition.status})`);

  const created = await createPublicationVersion(edition.id, { kind: "DRAFT", userId: admin?.id ?? null, notes: "Sample export" });
  console.log(`Version ${created.label} created — rendering…`);
  await renderVersion(created.id);
  const version = await getVersion(created.id);
  if (!version) throw new Error("Version disappeared");
  console.log(`Version ${version.label}: ${version.status}`);
  if (version.status !== "READY") {
    for (const issue of version.validationReport?.issues.filter((i) => i.severity === "error") ?? []) console.log(`  ✖ ${issue.code}: ${issue.message}`);
    for (const line of version.renderLog.slice(-5)) console.log(`  ${line.level}: ${line.message}`);
    throw new Error("Render did not complete");
  }

  const outDir = path.join(process.cwd(), "exports");
  await fs.mkdir(outDir, { recursive: true });
  const storage = getStorage();
  const base = `albert-deep-dive-${fileSlug(edition.slug)}-${version.label}`;
  const outputs: Record<string, string> = {};
  for (const asset of version.assets) {
    const buffer = await storage.get(asset.storageKey);
    if (!buffer) throw new Error(`Asset ${asset.fileName} missing from storage`);
    const target = path.join(outDir, `${base}.${asset.kind === "PDF" ? "pdf" : "docx"}`);
    await fs.writeFile(target, buffer);
    outputs[asset.kind] = target;
    console.log(`  ${asset.kind}: ${path.relative(process.cwd(), target)} (${Math.round(asset.sizeBytes / 1024)} kB${asset.pageCount ? `, ${asset.pageCount} pages` : ""})`);
  }

  // ── Validation & layout summary ────────────────────────────────────────
  const validation = version.validationReport;
  const layout = version.layoutReport;
  console.log("\nValidation:", validation ? `${validation.stats?.errors ?? 0} error(s), ${validation.stats?.warnings ?? 0} warning(s), ${validation.stats?.infos ?? 0} info` : "n/a");
  const counts = new Map<string, number>();
  for (const issue of validation?.issues ?? []) counts.set(`${issue.severity}:${issue.code}`, (counts.get(`${issue.severity}:${issue.code}`) ?? 0) + 1);
  for (const [key, n] of [...counts].sort()) console.log(`  ${key} × ${n}`);
  console.log("Layout:", layout ? `${layout.pageCount} pages, ${JSON.stringify(layout.stats)}` : "n/a");
  for (const issue of layout?.issues ?? []) console.log(`  ${issue.severity}: ${issue.message}`);

  // ── Verify outputs ─────────────────────────────────────────────────────
  const pdf = await PDFDocument.load(await fs.readFile(outputs.PDF));
  const pageCount = pdf.getPageCount();
  if (pageCount <= 0) throw new Error("PDF has no pages");
  console.log(`\nPDF check: ${pageCount} pages, title "${pdf.getTitle()}"`);
  const docx = verifyDocx(await fs.readFile(outputs.DOCX), edition.coverHeadline ?? undefined);
  if (!docx.ok) throw new Error(`DOCX check failed: ${docx.error}`);
  console.log(`DOCX check: word/document.xml well-formed, cover headline present (${Math.round(docx.documentXml.length / 1024)} kB of XML)`);
  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
