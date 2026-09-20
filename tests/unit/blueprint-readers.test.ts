import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import sharp from "sharp";
import { detectKind, readBlueprintFile } from "@/server/design/blueprint/read";
import { describeEvidence, normaliseFamily, paperName, rankColours } from "@/lib/design/blueprint";

/**
 * Reading somebody's newsletter for its shape, from whatever they happen to have.
 *
 * Each format is asked only for what it actually states, and the test is written the same way: a
 * Word document must give up its page size and its headings because it names them, a deck must
 * give up its theme because it carries one, and a picture must give up its colours and nothing
 * else — claiming more from a JPEG than its pixels would be the failure this whole module exists
 * to avoid.
 */

const THEME = `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements>
    <a:clrScheme name="Acme">
      <a:dk1><a:srgbClr val="111111"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:accent1><a:srgbClr val="C8102E"/></a:accent1>
      <a:accent2><a:srgbClr val="00539B"/></a:accent2>
    </a:clrScheme>
    <a:fontScheme name="Acme">
      <a:majorFont><a:latin typeface="Playfair Display"/></a:majorFont>
      <a:minorFont><a:latin typeface="Source Sans Pro"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements></a:theme>`;

async function docx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("word/theme/theme1.xml", THEME);
  zip.file("docProps/app.xml", "<Properties><Pages>4</Pages><Words>820</Words></Properties>");
  zip.file(
    "word/document.xml",
    `<w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Édito</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:rFonts w:ascii="Source Sans Pro"/><w:color w:val="C8102E"/></w:rPr><w:t>Ce mois-ci, beaucoup de choses se sont passées.</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Titre 2"/></w:pPr><w:r><w:t>Les chiffres du mois</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Portrait</w:t></w:r></w:p>
      <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1417" w:left="1134"/></w:sectPr>
    </w:body></w:document>`,
  );
  zip.file("word/media/image1.png", "not really a png");
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

async function pptx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("ppt/theme/theme1.xml", THEME);
  zip.file("ppt/presentation.xml", `<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld><p:cSld><p:spTree>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>La lettre d'Acme</a:t></a:r></a:p></p:txBody></p:sp>
      <p:sp><p:nvSpPr><p:nvPr><p:ph type="subTitle"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Novembre 2026</a:t></a:r></a:p></p:txBody></p:sp>
    </p:spTree></p:cSld></p:sld>`,
  );
  zip.file("ppt/slides/slide2.xml", `<p:sld><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Les chiffres du mois</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/media/image1.png", "not really a png");
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

const HTML = `<!doctype html><html><head><style>
  body { font-family: "Source Sans Pro", Helvetica, sans-serif; color: #111111; }
  .wrap { max-width: 600px; background: #ffffff; }
  h1 { font-family: 'Playfair Display', Georgia, serif; color: #c8102e; }
  .rule { border-top: 2px solid #c8102e; }
  .tag { color: #C8102E; }
</style></head><body><div class="wrap">
  <h1>La lettre d'Acme</h1><h2>Édito</h2><p>Bonjour à tous, voici les nouvelles du mois.</p>
  <h2>Les chiffres du mois</h2><img src="x.png"><p>Trois cent douze inscriptions.</p>
</div></body></html>`;

describe("reading a blueprint out of whatever they have", () => {
  it("knows what a file is from its bytes, not its name", async () => {
    expect(await detectKind(await docx(), "anything.txt")).toBe("docx");
    expect(await detectKind(await pptx(), "anything.txt")).toBe("pptx");
    expect(await detectKind(Buffer.from(HTML), "newsletter.pdf")).toBe("html");
    expect(await detectKind(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c8102e" } }).png().toBuffer(), "cover.pdf")).toBe("image");
    expect(await detectKind(Buffer.from("just some words"), "notes")).toBeNull();
  });

  it("takes a Word document's page, palette and running order from what it names", async () => {
    const { kind, evidence } = await readBlueprintFile(await docx(), "lettre.docx");
    expect(kind).toBe("docx");
    // A4 in twentieths of a point, and the margins the author set.
    expect(paperName(evidence.page!.widthPt, evidence.page!.heightPt)).toBe("A4");
    expect(evidence.page!.orientation).toBe("portrait");
    expect(Math.round(evidence.page!.margins!.left)).toBe(57);
    expect(evidence.colours[0].hex).toBe("#c8102e");
    expect(evidence.fonts.map((font) => font.family)).toContain("Playfair Display");
    expect(evidence.fonts.find((font) => font.family === "Playfair Display")?.role).toBe("heading");
    // "Titre 2" is a heading in French, and a reader that matched English would have missed it.
    expect(evidence.outline.map((item) => item.text)).toEqual(["Édito", "Les chiffres du mois", "Portrait"]);
    expect(evidence.outline.find((item) => item.text === "Les chiffres du mois")?.level).toBe(2);
    expect(evidence.counts).toMatchObject({ pages: 4, words: 820, images: 1 });
  });

  it("takes a deck's slide size, theme and titles", async () => {
    const { evidence } = await readBlueprintFile(await pptx(), "lettre.pptx");
    expect(Math.round(evidence.page!.widthPt)).toBe(960);
    expect(evidence.page!.orientation).toBe("landscape");
    expect(paperName(evidence.page!.widthPt, evidence.page!.heightPt)).toBe("16:9 slide");
    expect(evidence.colours.map((colour) => colour.hex)).toContain("#00539b");
    expect(evidence.fonts.find((font) => font.role === "body")?.family).toBe("Source Sans Pro");
    expect(evidence.outline.map((item) => item.text)).toEqual(["La lettre d'Acme", "Novembre 2026", "Les chiffres du mois"]);
    expect(evidence.counts.pages).toBe(2);
  });

  it("reads an email export from its own stylesheet", async () => {
    const { evidence } = await readBlueprintFile(Buffer.from(HTML), "campaign.html");
    // Declared five times in two cases; the ranking must not treat them as two colours.
    expect(evidence.colours[0].hex).toBe("#c8102e");
    expect(evidence.fonts.map((font) => font.family)).toEqual(expect.arrayContaining(["Source Sans Pro", "Playfair Display"]));
    expect(evidence.fonts.map((font) => font.family)).not.toContain("sans-serif");
    expect(evidence.outline.map((item) => item.text)).toEqual(["La lettre d'Acme", "Édito", "Les chiffres du mois"]);
    expect(Math.round(evidence.page!.widthPt)).toBe(450); // 600px at 0.75pt per px
    expect(evidence.counts.images).toBe(1);
  });

  it("claims nothing from a picture but its colours", async () => {
    const png = await sharp({ create: { width: 200, height: 300, channels: 3, background: "#00539b" } }).png().toBuffer();
    const { kind, evidence, shots } = await readBlueprintFile(png, "cover.png");
    expect(kind).toBe("image");
    expect(evidence.colours[0].hex).toBe("#00539b");
    expect(evidence.page!.orientation).toBe("portrait");
    expect(evidence.outline).toEqual([]);
    expect(evidence.fonts).toEqual([]);
    expect(shots).toHaveLength(1);
  });

  it("finds a PDF's page, its type and its headings by the sizes actually on the page", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]); // A4
    const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
    const sans = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText("La lettre d'Acme", { x: 56, y: 760, size: 28, font: serif, color: rgb(0.78, 0.06, 0.18) });
    page.drawText("Edito", { x: 56, y: 700, size: 18, font: serif, color: rgb(0.78, 0.06, 0.18) });
    for (let line = 0; line < 20; line += 1) {
      page.drawText("Ce mois-ci, beaucoup de choses se sont passees dans la maison.", { x: 56, y: 660 - line * 14, size: 10, font: sans, color: rgb(0.07, 0.07, 0.07) });
    }
    const { kind, evidence } = await readBlueprintFile(Buffer.from(await doc.save()), "lettre.pdf");
    expect(kind).toBe("pdf");
    expect(paperName(evidence.page!.widthPt, evidence.page!.heightPt)).toBe("A4");
    expect(evidence.counts.pages).toBe(1);
    // Twenty lines of body copy outweigh two headings, so the body size is the mode and the two
    // larger sizes are the headings — in that order, whatever the words say.
    if (evidence.outline.length) {
      expect(evidence.outline[0]).toMatchObject({ level: 1, text: "La lettre d'Acme" });
      expect(evidence.outline.map((item) => item.text)).toContain("Edito");
      expect(evidence.colours[0].hex).toMatch(/^#c[0-9a-f]{5}$/);
      expect(evidence.fonts.some((font) => /times/i.test(font.family) && font.role === "heading")).toBe(true);
    } else {
      // A machine without poppler reads the geometry and says so rather than inventing the rest.
      expect(evidence.notes.join(" ")).toContain("not installed");
    }
  });

  it("refuses what it cannot recognise, by name", async () => {
    await expect(readBlueprintFile(Buffer.from("hello"), "notes")).rejects.toMatchObject({ code: "BLUEPRINT_UNREADABLE" });
  });

  it("puts the brand colours before the ink and the paper", () => {
    const ranked = rankColours([
      { hex: "#ffffff", weight: 0.8, where: "pixels" },
      { hex: "#111111", weight: 0.15, where: "pixels" },
      { hex: "#c8102e", weight: 0.05, where: "pixels" },
    ]);
    expect(ranked[0].hex).toBe("#c8102e");
    // Kept, not dropped: a title genuinely printed in black and white is still a title.
    expect(ranked.map((colour) => colour.hex)).toContain("#111111");
  });

  it("calls a font what a person calls it", () => {
    expect(normaliseFamily("ABCDEF+HelveticaNeue-Bold")).toBe("Helvetica Neue");
    expect(normaliseFamily("PlayfairDisplay-Italic")).toBe("Playfair Display");
    expect(normaliseFamily("Arial")).toBe("Arial");
  });

  it("describes what it found in sentences, because the next pass has to reason about it", async () => {
    const { evidence } = await readBlueprintFile(await docx(), "lettre.docx");
    const described = describeEvidence(evidence);
    expect(described).toContain("A4, portrait");
    expect(described).toContain("#c8102e");
    expect(described).toContain("Édito");
    expect(described).not.toContain('"hex"');
  });
});
