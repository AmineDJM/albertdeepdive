import JSZip from "jszip";
import path from "node:path";
import { BLUEPRINT_KINDS, type BlueprintEvidence, type BlueprintKind } from "@/lib/design/blueprint";
import { readPdf } from "./pdf";
import { readDocx, readPptx } from "./office";
import { readHtml, readImage } from "./web";

/**
 * Whatever they have, read.
 *
 * The instruction was to be powerful about this, and the way to be powerful about it is to refuse
 * nothing a person might reasonably call "our newsletter": the PDF the printer sent back, the Word
 * file it was written in, the deck somebody actually uses instead of a newsletter, the HTML export
 * from Mailchimp, or a screenshot. Each states a different amount about itself, and each is read
 * for exactly what it states — no format is made to pretend it knows more than it does.
 *
 * The type comes from the bytes rather than the name. A file called `newsletter.pdf` that is really
 * a PNG is a file somebody renamed, and trusting the extension is how a reader ends up parsing a
 * JPEG as XML and reporting that the document has no structure.
 */

export type BlueprintReading = {
  kind: BlueprintKind;
  evidence: BlueprintEvidence;
  /** Pictures of the pages, for the pass that looks rather than measures. */
  shots: Buffer[];
};

export class UnreadableBlueprintError extends Error {
  readonly code = "BLUEPRINT_UNREADABLE";
  constructor(message: string) {
    super(message);
    this.name = "UnreadableBlueprintError";
  }
}

/** Which of the five this is, from the bytes first and the name only as a tiebreak. */
export async function detectKind(bytes: Buffer, fileName: string): Promise<BlueprintKind | null> {
  const { fileTypeFromBuffer } = await import("file-type");
  const detected = await fileTypeFromBuffer(bytes).catch(() => undefined);
  const mime = detected?.mime ?? "";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/zip" || detected?.ext === "zip" || detected?.ext === "docx" || detected?.ext === "pptx") {
    // Word and PowerPoint are the same container; only what is inside it tells them apart.
    try {
      const zip = await JSZip.loadAsync(bytes);
      if (zip.file("word/document.xml")) return "docx";
      if (zip.file("ppt/presentation.xml")) return "pptx";
    } catch {
      /* fall through to the name */
    }
  }
  const head = bytes.subarray(0, 2048).toString("utf8").toLowerCase();
  if (/<!doctype html|<html|<table|<mjml/.test(head)) return "html";
  const ext = path.extname(fileName).toLowerCase();
  const byName: Record<string, BlueprintKind> = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".doc": "docx",
    ".pptx": "pptx",
    ".ppt": "pptx",
    ".html": "html",
    ".htm": "html",
    ".mjml": "html",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".webp": "image",
    ".gif": "image",
    ".avif": "image",
    ".heic": "image",
  };
  return byName[ext] ?? null;
}

export async function readBlueprintFile(bytes: Buffer, fileName: string): Promise<BlueprintReading> {
  const kind = await detectKind(bytes, fileName);
  if (!kind) {
    throw new UnreadableBlueprintError(
      `Briefly could not tell what “${fileName}” is. A PDF, a Word document, a PowerPoint deck, an HTML export or a picture of the page all work.`,
    );
  }
  const read = await readerFor(kind)(bytes, fileName);
  return { kind, evidence: read.evidence, shots: read.shots };
}

function readerFor(kind: BlueprintKind): (bytes: Buffer, fileName: string) => Promise<{ evidence: BlueprintEvidence; shots: Buffer[] }> {
  switch (kind) {
    case "pdf":
      return readPdf;
    case "docx":
      return (bytes) => readDocx(bytes);
    case "pptx":
      return (bytes) => readPptx(bytes);
    case "html":
      return (bytes) => readHtml(bytes);
    case "image":
      return (bytes) => readImage(bytes);
  }
}

/** The formats the upload control should offer, as an `accept` attribute. */
export const BLUEPRINT_ACCEPT = ".pdf,.docx,.doc,.pptx,.ppt,.html,.htm,.mjml,.png,.jpg,.jpeg,.webp,.avif,application/pdf,image/*";

export { BLUEPRINT_KINDS };
