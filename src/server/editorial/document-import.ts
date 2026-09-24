import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { enqueueJob } from "@/server/jobs/queue";
import { JOB_TYPES } from "@/server/jobs/registry";
import { kickJobRunner } from "@/server/jobs/runner";
import { guardTenant } from "@/server/tenancy/scope";
import { NotFoundError, ValidationError } from "@/lib/action-result";

/**
 * A document of content, turned into topics.
 *
 * An editor often has the news already written down somewhere — a report, a deck from the last
 * board meeting, a page of notes, last term's bulletin. Asking the people again for what is in it
 * would be silly. So the Topics screen takes the file itself: its text is read, cut where the
 * document cuts itself (its headings, its slides), and each part becomes a contribution from the
 * editor. Briefly's pipeline then does to those exactly what it does to anybody else's: classifies
 * them, groups what belongs together, and proposes the topics.
 */

export type DocumentSection = { title: string | null; body: string };
export type DocumentKind = "pdf" | "docx" | "pptx" | "text" | "html";

const MAX_SECTIONS = 30;
const MAX_SECTION_CHARS = 6000;
const TARGET_CHUNK_CHARS = 1800;
const MIN_SECTION_CHARS = 60;

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

function clean(text: string): string {
  return text.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export function kindOf(fileName: string, mimeType?: string | null): DocumentKind | null {
  const name = fileName.toLowerCase();
  if (mimeType === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx") || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (name.endsWith(".pptx") || mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation") return "pptx";
  if (name.endsWith(".html") || name.endsWith(".htm") || mimeType === "text/html") return "html";
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown") || mimeType?.startsWith("text/")) return "text";
  return null;
}

/** Paragraphs with the ones that are headings marked, in reading order. */
type Paragraph = { text: string; heading: boolean };

async function docxParagraphs(bytes: Buffer): Promise<Paragraph[]> {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) throw new ValidationError("That Word file has no text we can read");
  const out: Paragraph[] = [];
  for (const para of xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []) {
    const style = /<w:pStyle w:val="([^"]+)"/.exec(para)?.[1] ?? "";
    const text = clean(decodeXml((para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((run) => run.replace(/<[^>]+>/g, "")).join("")));
    if (!text) continue;
    // "Heading1", "Titre1", "Title", "Überschrift1": a heading by any name, in any language.
    out.push({ text, heading: /^(heading|titre|title|berschrift|kop|t[íi]tulo|intestazione)/i.test(style.replace(/^[^a-z]*/i, "")) || /^(Heading|Titre)\d/.test(style) });
  }
  return out;
}

async function pptxSections(bytes: Buffer): Promise<DocumentSection[]> {
  const zip = await JSZip.loadAsync(bytes);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  const out: DocumentSection[] = [];
  for (const name of slides) {
    const xml = (await zip.file(name)?.async("string")) ?? "";
    const lines = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) ?? []).map((p) => clean(decodeXml((p.match(/<a:t>([^<]*)<\/a:t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, "")).join("")))).filter(Boolean);
    if (!lines.length) continue;
    out.push({ title: lines[0].slice(0, 160), body: lines.slice(1).join("\n") || lines[0] });
  }
  return out;
}

async function pdfParagraphs(bytes: Buffer): Promise<Paragraph[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.flatMap((page) => page.split(/\n\s*\n/).map((block) => ({ text: clean(block), heading: false }))).filter((p) => p.text);
}

function textParagraphs(raw: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const block of raw.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    for (const line of block.split("\n")) {
      const heading = /^#{1,3}\s+(.+)$/.exec(line.trim());
      if (heading) out.push({ text: heading[1].trim(), heading: true });
    }
    const body = clean(block.split("\n").filter((line) => !/^#{1,3}\s+/.test(line.trim())).join("\n"));
    if (body) out.push({ text: body, heading: false });
  }
  return out;
}

function htmlParagraphs(html: string): Paragraph[] {
  const body = html.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ");
  const out: Paragraph[] = [];
  for (const match of body.matchAll(/<(h[1-3]|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = clean(decodeXml(match[2].replace(/<[^>]+>/g, " ")));
    if (text) out.push({ text, heading: /^h/i.test(match[1]) });
  }
  return out.length ? out : textParagraphs(clean(decodeXml(body.replace(/<[^>]+>/g, "\n"))));
}

/**
 * Cut paragraphs into sections: at every heading when the document has them, otherwise into parts
 * of a readable length at paragraph boundaries. Parts too short to be about anything join the one
 * before them.
 */
export function sectionise(paragraphs: Paragraph[]): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const hasHeadings = paragraphs.some((p) => p.heading);
  let current: DocumentSection | null = null;
  for (const para of paragraphs) {
    if (para.heading) {
      if (current && current.body) sections.push(current);
      current = { title: para.text.slice(0, 160), body: "" };
      continue;
    }
    if (!current) current = { title: null, body: "" };
    if (!hasHeadings && current.body.length + para.text.length > TARGET_CHUNK_CHARS && current.body.length >= MIN_SECTION_CHARS) {
      sections.push(current);
      current = { title: null, body: "" };
    }
    current.body = current.body ? `${current.body}\n\n${para.text}` : para.text;
  }
  if (current && (current.body || current.title)) sections.push(current.body ? current : { ...current, body: current.title ?? "" });

  const merged: DocumentSection[] = [];
  for (const section of sections) {
    const previous = merged[merged.length - 1];
    if (previous && section.body.length < MIN_SECTION_CHARS && !section.title) previous.body = `${previous.body}\n\n${section.body}`;
    else merged.push({ ...section });
  }
  return merged.filter((section) => section.body.trim().length >= 20).slice(0, MAX_SECTIONS).map((section) => ({ title: section.title, body: section.body.slice(0, MAX_SECTION_CHARS) }));
}

export async function readDocumentSections(bytes: Buffer, fileName: string, mimeType?: string | null): Promise<{ kind: DocumentKind; sections: DocumentSection[] }> {
  const kind = kindOf(fileName, mimeType);
  if (!kind) throw new ValidationError("Briefly reads PDF, Word, PowerPoint, text, Markdown and HTML files", { file: ["Unsupported file type"] });
  let sections: DocumentSection[];
  try {
    sections =
      kind === "pptx"
        ? await pptxSections(bytes)
        : sectionise(kind === "docx" ? await docxParagraphs(bytes) : kind === "pdf" ? await pdfParagraphs(bytes) : kind === "html" ? htmlParagraphs(bytes.toString("utf8")) : textParagraphs(bytes.toString("utf8")));
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError("That file could not be read. Is it damaged, or protected by a password?", { file: ["Unreadable"] });
  }
  if (!sections.length) throw new ValidationError("There is no text in that file to make topics from", { file: ["No text found"] });
  return { kind, sections };
}

function titleFor(section: DocumentSection, fileName: string, index: number): string {
  if (section.title) return section.title;
  const first = section.body.split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? "";
  return (first.length > 8 ? first : `${fileName.replace(/\.[^.]+$/, "")} — ${index + 1}`).slice(0, 120);
}

/**
 * File the document's parts as contributions to the edition and hand them to the pipeline.
 *
 * Nothing waits for the reading: the parts are filed at once and a job turns them into topics,
 * which appear on the Topics screen as soon as it has.
 */
export async function importDocumentAsTopics(input: { editionId: string; bytes: Buffer; fileName: string; mimeType?: string | null; user: { id: string; name: string; email: string } }): Promise<{ sections: number; jobId: string }> {
  const edition = await guardTenant(await db.query.editions.findFirst({ where: eq(s.editions.id, input.editionId), columns: { id: true, organizationId: true, publicationId: true } }), "Edition");
  if (!edition) throw new NotFoundError("Edition");
  const { kind, sections } = await readDocumentSections(input.bytes, input.fileName, input.mimeType);
  const publication = edition.publicationId ? await db.query.publications.findFirst({ where: eq(s.publications.id, edition.publicationId), columns: { language: true } }) : null;

  const rows = await db
    .insert(s.submissions)
    .values(
      sections.map((section, index) => ({
        editionId: edition.id,
        storyType: "OTHER" as const,
        title: titleFor(section, input.fileName, index),
        description: section.body,
        campusScope: "SCHOOL_WIDE" as const,
        contactName: input.user.name,
        contactEmail: input.user.email,
        language: publication?.language ?? "en",
        status: "NEW" as const,
        source: "document",
        // The editor's own material, filed by the editor.
        publicationConsent: true,
        wordCount: section.body.split(/\s+/).filter(Boolean).length,
        extra: { document: input.fileName, kind, part: index + 1, of: sections.length },
      })),
    )
    .returning({ id: s.submissions.id });

  const job = await enqueueJob({
    type: JOB_TYPES.TOPICS_FROM_DOCUMENT,
    payload: { editionId: edition.id, submissionIds: rows.map((row) => row.id), userId: input.user.id },
    idempotencyKey: `topics-document:${edition.id}:${rows[0].id}`,
    createdById: input.user.id,
    priority: 3,
  });
  kickJobRunner();
  await audit({ action: "topics.document.import", userId: input.user.id, entityType: "EDITION", entityId: edition.id, editionId: edition.id, metadata: { fileName: input.fileName, kind, sections: rows.length } });
  return { sections: rows.length, jobId: job.id };
}
