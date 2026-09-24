import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { importDocumentAsTopics, readDocumentSections, sectionise } from "@/server/editorial/document-import";
import { getJobHandler, JOB_TYPES } from "@/server/jobs/registry";
import { runAsOrganization } from "@/server/tenancy/context";
import { createOrganization } from "@/server/tenancy/service";
import "@/server/jobs/handlers";

/**
 * A document of content, turned into topics.
 *
 * The file is read for its text, cut where it cuts itself — its headings, its slides — and each part
 * becomes one of the editor's own contributions to the edition; the pipeline then groups them and
 * proposes topics, the same way it does for anybody's.
 */
describe("topics from a document", () => {
  let orgId: string;
  let editionId: string;
  let user: { id: string; name: string; email: string };

  beforeAll(async () => {
    await ensureSeeded();
    orgId = (await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") }))!.id;
    editionId = (await db.query.editions.findFirst({ where: eq(s.editions.label, "October 2026") }))!.id;
    const admin = (await db.query.users.findFirst({ where: eq(s.users.email, "admin@albertschool.com") }))!;
    user = { id: admin.id, name: admin.name, email: admin.email };
  });

  it("cuts at headings when there are some, and into readable parts when there are none", () => {
    const withHeadings = sectionise([
      { text: "Rowing club wins the regatta", heading: true },
      { text: "The eight crossed the line two lengths ahead of Lyon after a season of early mornings.", heading: false },
      { text: "New data lab opens", heading: true },
      { text: "Forty workstations and a GPU cluster, open to every programme from Monday.", heading: false },
    ]);
    expect(withHeadings.map((section) => section.title)).toEqual(["Rowing club wins the regatta", "New data lab opens"]);

    const long = Array.from({ length: 12 }, (_, i) => ({ text: `Paragraph ${i} `.padEnd(400, "x"), heading: false }));
    const parts = sectionise(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.body.length <= 6000)).toBe(true);
  });

  it("reads Markdown, HTML, Word and PDF", async () => {
    const md = await readDocumentSections(Buffer.from("# Rowing\nThe eight won the regatta by two lengths.\n\n# Data lab\nForty new workstations open on Monday."), "notes.md");
    expect(md.sections.map((section) => section.title)).toEqual(["Rowing", "Data lab"]);

    const html = await readDocumentSections(Buffer.from("<html><body><h2>Alumni dinner</h2><p>Two hundred alumni came back to Paris for the annual dinner.</p><script>x()</script></body></html>"), "page.html");
    expect(html.sections[0]).toMatchObject({ title: "Alumni dinner" });
    expect(html.sections[0].body).not.toContain("x()");

    const word = await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph({ text: "Hackathon results", heading: HeadingLevel.HEADING_1 }),
              new Paragraph("Twelve teams built tools for the city's transport agency over one weekend."),
              new Paragraph({ text: "Library hours", heading: HeadingLevel.HEADING_1 }),
              new Paragraph("The library now stays open until midnight during the exam weeks."),
            ],
          },
        ],
      }),
    );
    const docx = await readDocumentSections(Buffer.from(word), "bulletin.docx");
    expect(docx.kind).toBe("docx");
    expect(docx.sections.map((section) => section.title)).toEqual(["Hackathon results", "Library hours"]);

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    pdfDoc.addPage().drawText("The school opens a campus in Geneva next September.", { x: 50, y: 700, size: 12, font });
    const pdf = await readDocumentSections(Buffer.from(await pdfDoc.save()), "report.pdf");
    expect(pdf.kind).toBe("pdf");
    expect(pdf.sections[0].body).toContain("campus in Geneva");

    await expect(readDocumentSections(Buffer.from("x"), "photo.jpg")).rejects.toThrow(/PDF, Word/);
  });

  it("files each part as the editor's contribution, then turns them into topics", async () => {
    const doc = Buffer.from("# Rowing club wins the regatta\nThe eight crossed the line two lengths ahead of Lyon after a season of early mornings on the Seine.\n\n# New data lab opens\nForty workstations and a GPU cluster open to every programme from Monday, with training sessions every Friday.");
    const result = await runAsOrganization(orgId, () => importDocumentAsTopics({ editionId, bytes: doc, fileName: "october-notes.md", mimeType: "text/markdown", user }));
    expect(result.sections).toBe(2);

    const filed = await db.query.submissions.findMany({ where: and(eq(s.submissions.editionId, editionId), eq(s.submissions.source, "document")) });
    const ours = filed.filter((row) => (row.extra as { document?: string }).document === "october-notes.md");
    expect(ours.map((row) => row.title).sort()).toEqual(["New data lab opens", "Rowing club wins the regatta"]);
    expect(ours.every((row) => row.publicationConsent && row.contactEmail === user.email)).toBe(true);

    const job = (await db.query.jobs.findFirst({ where: eq(s.jobs.id, result.jobId) }))!;
    expect(job.type).toBe(JOB_TYPES.TOPICS_FROM_DOCUMENT);
    const handler = getJobHandler(JOB_TYPES.TOPICS_FROM_DOCUMENT)!;
    const outcome = (await handler(job.payload, { job, workerId: "test", progress: async () => {}, log: () => {} })) as { processed: number };
    expect(outcome.processed).toBe(2);

    const members = await db.select({ submissionId: s.storyClusterMembers.submissionId }).from(s.storyClusterMembers).where(inArray(s.storyClusterMembers.submissionId, ours.map((row) => row.id)));
    expect(members.length).toBeGreaterThan(0);
  });

  it("refuses another workspace's edition", async () => {
    const other = await createOrganization({ name: "Elsewhere", type: "COMPANY", locale: "en", timezone: "Europe/Paris" }, user.id);
    await expect(runAsOrganization(other.id, () => importDocumentAsTopics({ editionId, bytes: Buffer.from("# A\nSome text long enough to count as a section of a document."), fileName: "x.md", user }))).rejects.toThrow(/not found/i);
  });
});
