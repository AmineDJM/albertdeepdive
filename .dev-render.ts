/* Temporary development helper (deleted before hand-off): renders the seeded edition and screenshots pages. */
import "@/server/load-env";
import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { editions } from "@/server/db/schema";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { renderPdf, launchBrowser, screenshotPage } from "@/server/publication/pdf";

async function shotsOnly(pages: number[]) {
  const outDir = path.join(process.cwd(), "exports", "dev");
  const html = await fs.readFile(path.join(outDir, "final.html"), "utf8");
  const browser = await launchBrowser();
  try {
    for (const n of pages) {
      const png = await screenshotPage(html, n, { browser, scale: 1.4 });
      await fs.writeFile(path.join(outDir, `page-${String(n).padStart(2, "0")}.png`), png);
    }
  } finally {
    await browser.close();
  }
  process.exit(0);
}

async function main() {
  if (process.argv[3] === "shots") return shotsOnly(process.argv[2].split(",").map(Number));
  const t0 = Date.now();
  const edition = await db.query.editions.findFirst({ where: eq(editions.issueNumber, 1) });
  if (!edition) throw new Error("no edition");
  const doc = await buildEditionDocument(edition.id, { versionLabel: "dev", includeUnapproved: true });
  console.log("doc", { articles: doc.articles.length, pages: doc.pages.length, media: doc.media.length, warnings: doc.warnings.map((w) => w.code) });
  const outDir = path.join(process.cwd(), "exports", "dev");
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "document.json"), JSON.stringify(doc, null, 2));
  const browser = await launchBrowser();
  try {
    const result = await renderPdf(doc, { browser, log: (m, level, meta) => console.log(level, m, meta ? JSON.stringify(meta).slice(0, 300) : "") });
    await fs.writeFile(path.join(outDir, "dev.pdf"), result.buffer);
    await fs.writeFile(path.join(outDir, "final.html"), result.html);
    await fs.writeFile(path.join(outDir, "final-document.json"), JSON.stringify(result.finalDocument, null, 2));
    await fs.writeFile(path.join(outDir, "layout-report.json"), JSON.stringify(result.layoutReport, null, 2));
    console.log("pdf pages", result.pageCount, "bytes", result.buffer.length, "ms", Date.now() - t0);
    console.log("report", JSON.stringify({ ...result.layoutReport, fit: undefined }, null, 0));
    console.log("fit", result.layoutReport.fit.map((f) => `${f.page}:${f.template}:${f.ratio}`).join(" "));
    const pagesArg = process.argv[2] ?? "1,2,3";
    const wanted = pagesArg === "all" ? result.finalDocument.pages.map((p) => p.number) : pagesArg.split(",").map(Number);
    for (const n of wanted) {
      const png = await screenshotPage(result.html, n, { browser, scale: 1.4 });
      await fs.writeFile(path.join(outDir, `page-${String(n).padStart(2, "0")}.png`), png);
    }
    console.log("screenshots", wanted.join(","), "ms", Date.now() - t0);
  } finally {
    await browser.close();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
