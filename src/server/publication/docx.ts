import sharp from "sharp";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LeaderType,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  SectionType,
  ShadingType,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ISectionOptions,
} from "docx";
import type { ArticleBlock, DocumentArticle, DocumentMedia, EditionDocument } from "@/lib/publication/document";
import { formatIsoDate, monthName } from "@/lib/publication/text";
import { getStorage } from "@/server/storage";
import { createLogger } from "@/server/logger";
import { checkXmlWellFormed, readZipEntry } from "./zip";

const log = createLogger("publication:docx");

/**
 * DOCX rendering from the same canonical EditionDocument as the PDF: title page, contents, then
 * every planned article in flatplan order (section heading on section change, kicker, headline,
 * standfirst, body blocks, images with captions, BDD structured section), colophon at the end.
 * Headers carry the issue label and masthead, footers the page number; long articles flow in two
 * columns via section properties.
 */

const NAVY = "10203A";
const CHARCOAL = "202932";
const GREY = "7B7B7B";
const BLUE = "2BAFE0";
const TINT = "F2F3F5";
const PAGE_WIDTH_TWIP = 11906; // A4
const PAGE_HEIGHT_TWIP = 16838;
const MARGIN_TWIP = 1418; // 25 mm
const TEXT_WIDTH_TWIP = PAGE_WIDTH_TWIP - 2 * MARGIN_TWIP;
const FULL_IMAGE_PX = 605; // 16 cm at 96 dpi
const COLUMN_IMAGE_PX = 292; // ≈ 7.7 cm column
const MAX_IMAGE_HEIGHT_PX = 640;
const TWO_COLUMN_MIN_WORDS = 300;

type LoadedImage = { data: Buffer; type: "jpg" | "png"; width: number; height: number };

async function loadImage(media: DocumentMedia): Promise<LoadedImage | null> {
  const storage = await getStorage();
  for (const key of [media.src.web?.key, media.src.print?.key, media.src.thumb?.key]) {
    if (!key) continue;
    const buffer = await storage.get(key);
    if (!buffer) continue;
    try {
      const image = sharp(buffer, { failOn: "none" });
      const meta = await image.metadata();
      const png = meta.format === "png" && !!meta.hasAlpha;
      const pipeline = image.resize({ width: 1600, withoutEnlargement: true });
      const out = png
        ? await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true })
        : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      return { data: out.data, type: png ? "png" : "jpg", width: out.info.width, height: out.info.height };
    } catch (err) {
      log.warn("image transcoding failed", { key, err });
    }
  }
  return null;
}

function fitSize(image: LoadedImage, maxWidth: number): { width: number; height: number } {
  const aspect = image.width / image.height || 1.5;
  let width = Math.min(maxWidth, image.width);
  let height = width / aspect;
  if (height > MAX_IMAGE_HEIGHT_PX) {
    height = MAX_IMAGE_HEIGHT_PX;
    width = height * aspect;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

function text(content: string, options: Partial<ConstructorParameters<typeof TextRun>[0] & object> = {}): TextRun {
  return new TextRun({ text: content, ...(options as object) });
}

function para(style: string, content: string | TextRun[], extra: Record<string, unknown> = {}): Paragraph {
  return new Paragraph({ style, children: typeof content === "string" ? [text(content)] : content, ...extra });
}

function paragraphsOf(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function creditOf(media: DocumentMedia | undefined): string | null {
  if (!media) return null;
  return media.credit ?? (media.photographer ? `© ${media.photographer}` : null);
}

function captionParagraph(caption: string | null | undefined, credit: string | null | undefined): Paragraph | null {
  if (!caption && !credit) return null;
  const runs: TextRun[] = [];
  if (caption) runs.push(text(caption));
  if (credit) runs.push(text(`${caption ? "  " : ""}${credit}`, { color: GREY }));
  return para("Caption", runs);
}

function box(title: string | undefined, body: string | undefined, items: string[] | undefined, numbering: NumberingState): Table {
  const children: Paragraph[] = [];
  if (title) children.push(para("BoxTitle", title));
  if (body) for (const p of paragraphsOf(body)) children.push(para("Body", p, { alignment: AlignmentType.LEFT }));
  for (const item of items ?? []) children.push(new Paragraph({ style: "Body", alignment: AlignmentType.LEFT, numbering: { reference: "bullets", level: 0 }, children: [text(item)] }));
  if (!children.length) children.push(para("Body", ""));
  numbering.bulletsUsed = true;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { fill: TINT, type: ShadingType.CLEAR, color: "auto" },
            margins: { top: 160, bottom: 120, left: 200, right: 200 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 18, color: NAVY },
              bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
              left: { style: BorderStyle.NONE, size: 0, color: "auto" },
              right: { style: BorderStyle.NONE, size: 0, color: "auto" },
            },
            children,
          }),
        ],
      }),
    ],
  });
}

type NumberingState = { orderedInstance: number; bulletsUsed: boolean };

function imageParagraphs(image: LoadedImage | null, media: DocumentMedia | undefined, maxWidth: number, caption?: string | null, credit?: string | null): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (image) {
    const size = fitSize(image, maxWidth);
    out.push(
      new Paragraph({
        spacing: { before: 120, after: 60 },
        keepNext: true,
        children: [
          new ImageRun({
            type: image.type,
            data: image.data,
            transformation: { width: size.width, height: size.height },
            altText: { name: media?.fileName ?? "image", description: media?.altText ?? media?.caption ?? "", title: media?.caption ?? media?.fileName ?? "image" },
          }),
        ],
      }),
    );
  }
  const cap = captionParagraph(caption ?? media?.caption, credit ?? creditOf(media));
  if (cap) out.push(cap);
  return out;
}

function blockParagraphs(block: ArticleBlock, ctx: { images: Map<string, LoadedImage | null>; media: Map<string, DocumentMedia>; numbering: NumberingState; imageWidth: number; hideSpeaker?: boolean }): (Paragraph | Table)[] {
  switch (block.type) {
    case "paragraph":
      return paragraphsOf(block.text).map((p) => para("Body", p));
    case "crosshead":
      return [para("Crosshead", block.text)];
    case "pullquote": {
      const runs = [text(`“${block.text.replace(/^["“]|["”]$/g, "")}”`)];
      if (block.attribution) runs.push(text(`  — ${block.attribution}`, { italics: false, size: 16, color: GREY, font: "Arial" }));
      return [para("PullQuote", runs)];
    }
    case "list": {
      if (block.ordered) ctx.numbering.orderedInstance += 1;
      else ctx.numbering.bulletsUsed = true;
      const instance = ctx.numbering.orderedInstance;
      return block.items.map(
        (item) =>
          new Paragraph({
            style: "Body",
            alignment: AlignmentType.LEFT,
            numbering: block.ordered ? { reference: "numbers", level: 0, instance } : { reference: "bullets", level: 0 },
            children: [text(item)],
          }),
      );
    }
    case "image": {
      const media = ctx.media.get(block.assetId);
      return imageParagraphs(ctx.images.get(block.assetId) ?? null, media, ctx.imageWidth, block.caption ?? media?.caption, block.credit ?? creditOf(media));
    }
    case "box":
      return [box(block.title, block.text, block.items, ctx.numbering), para("Body", "", { spacing: { after: 60 } })];
    case "qa":
      return [para("QAQuestion", block.question), ...paragraphsOf(block.answer).map((p) => para("QAAnswer", p))];
    case "testimony": {
      const runs = [text(block.text)];
      const out = [para("Testimony", runs)];
      if (block.speaker && !ctx.hideSpeaker) out.push(para("Caption", `— ${block.speaker}`, { indent: { left: 400 } }));
      return out;
    }
    case "divider":
      return [new Paragraph({ spacing: { before: 120, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "D5D7DB", space: 4 } }, children: [] })];
  }
}

function headerFor(doc: EditionDocument): Header {
  return new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH_TWIP }],
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 4 } },
        children: [
          text(`${doc.meta.issueLabel} · ${monthName(doc.meta.month)} ${doc.meta.year}`, { font: "Arial", size: 15, color: GREY, allCaps: true, characterSpacing: 20 }),
          new TextRun({ children: [new Tab(), doc.meta.masthead.title], font: "Arial", size: 15, bold: true, color: NAVY, allCaps: true, characterSpacing: 20 }),
        ],
      }),
    ],
  });
}

function footerFor(doc: EditionDocument): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: CHARCOAL }),
          text(`  ·  ${doc.meta.masthead.title} — ${doc.meta.issueLabel}`, { font: "Arial", size: 14, color: GREY }),
        ],
      }),
    ],
  });
}

function sectionProps(doc: EditionDocument, type: (typeof SectionType)[keyof typeof SectionType], columns = 1): Pick<ISectionOptions, "properties" | "headers" | "footers"> {
  return {
    properties: {
      type,
      page: { size: { width: PAGE_WIDTH_TWIP, height: PAGE_HEIGHT_TWIP }, margin: { top: MARGIN_TWIP, right: MARGIN_TWIP, bottom: MARGIN_TWIP, left: MARGIN_TWIP, header: 708, footer: 708 } },
      column: columns > 1 ? { count: columns, space: 400, separate: false } : undefined,
    },
    headers: { default: headerFor(doc) },
    footers: { default: footerFor(doc) },
  };
}

function bddParagraphs(article: DocumentArticle, numbering: NumberingState): Paragraph[] {
  const bdd = article.bdd;
  if (!bdd) return [];
  const out: Paragraph[] = [para("Crosshead", `Business Deep Dive — ${[bdd.companyName, bdd.cohortLabel].filter(Boolean).join(" – ")}`)];
  const labelled: [string, string | null | undefined][] = [
    ["Dates", bdd.dateText],
    ["The case", bdd.theCase],
    ["The data", bdd.theData],
    ["The challenge", bdd.theChallenge],
    ["The approach", bdd.theApproach],
    ["The methods", bdd.theMethods ?? (bdd.technologies.length ? bdd.technologies.join(", ") : null)],
    ["The solution", bdd.theSolution],
    ["The results", bdd.theResults],
    ["The winning team", bdd.winningTeam.length ? bdd.winningTeam.map((m) => m.name).join(", ") : null],
    ["Finalists", bdd.finalists.length ? bdd.finalists.map((team) => team.map((m) => m.name).join(", ")).join(" · ") : null],
    ["The jury", bdd.jury.length ? bdd.jury.map((j) => [j.name, [j.role, j.organisation].filter(Boolean).join(", ")].filter(Boolean).join(" — ")).join(" · ") : null],
  ];
  for (const [label, value] of labelled) {
    if (!value) continue;
    out.push(new Paragraph({ style: "Body", alignment: AlignmentType.LEFT, spacing: { after: 80 }, children: [text(`${label.toUpperCase()}  `, { font: "Arial", size: 15, bold: true, color: NAVY, characterSpacing: 20 }), text(value)] }));
  }
  if (bdd.metrics.length) {
    out.push(new Paragraph({ style: "Body", alignment: AlignmentType.LEFT, children: [text("KEY FIGURES  ", { font: "Arial", size: 15, bold: true, color: NAVY, characterSpacing: 20 }), text(bdd.metrics.map((m) => `${m.value} ${m.label}`).join(" · "))] }));
  }
  if (bdd.keyTakeaways.length) {
    out.push(para("BoxTitle", "Key takeaways"));
    numbering.bulletsUsed = true;
    for (const t of bdd.keyTakeaways) out.push(new Paragraph({ style: "Body", alignment: AlignmentType.LEFT, numbering: { reference: "bullets", level: 0 }, children: [text(t)] }));
  }
  return out;
}

export type RenderDocxOptions = { log?: (message: string, level?: "info" | "warn" | "error", meta?: Record<string, unknown>) => void };

export async function renderDocx(doc: EditionDocument, options: RenderDocxOptions = {}): Promise<Buffer> {
  const say = options.log ?? ((message, level = "info", meta) => log[level](message, meta));
  const mediaById = new Map(doc.media.map((m) => [m.id, m]));
  const articleById = new Map(doc.articles.map((a) => [a.id, a]));
  const sectionById = new Map(doc.sections.map((s) => [s.id, s]));
  const monthLabel = `${monthName(doc.meta.month)} ${doc.meta.year}`;
  const numbering: NumberingState = { orderedInstance: 0, bulletsUsed: false };

  // Articles in flatplan order (first appearance), skipping layout-generated continuation pages.
  const ordered: { article: DocumentArticle; sectionId: string | null }[] = [];
  const seen = new Set<string>();
  for (const page of doc.pages) {
    if (page.template === "CONTINUATION") continue;
    for (const id of page.articleIds) {
      if (seen.has(id)) continue;
      const article = articleById.get(id);
      if (!article) continue;
      seen.add(id);
      ordered.push({ article, sectionId: page.sectionId ?? article.sectionId });
    }
  }

  // Preload images (WEB variant, transcoded for Word).
  const images = new Map<string, LoadedImage | null>();
  const wanted = new Set<string>();
  if (doc.meta.cover.mediaId) wanted.add(doc.meta.cover.mediaId);
  for (const { article } of ordered) {
    for (const m of article.media) if (m.role !== "cover") wanted.add(m.mediaId);
    for (const b of article.body) if (b.type === "image") wanted.add(b.assetId);
  }
  for (const id of [...wanted].sort()) {
    const media = mediaById.get(id);
    if (!media || media.rightsStatus === "RED") continue;
    images.set(id, await loadImage(media));
  }
  say("docx images loaded", "info", { count: images.size });

  const sections: ISectionOptions[] = [];

  // ── Title page ──────────────────────────────────────────────────────────
  const coverMedia = doc.meta.cover.mediaId ? mediaById.get(doc.meta.cover.mediaId) : undefined;
  const titleChildren: (Paragraph | Table)[] = [
    para("Title", doc.meta.masthead.title),
    para("Subtitle", `${doc.meta.issueLabel} · ${monthLabel}`),
  ];
  if (doc.meta.masthead.tagline) titleChildren.push(para("Caption", doc.meta.masthead.tagline));
  titleChildren.push(new Paragraph({ spacing: { after: 400 }, children: [] }));
  if (doc.meta.cover.headline) titleChildren.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text(doc.meta.cover.headline)] }));
  if (doc.meta.cover.standfirst) titleChildren.push(para("Standfirst", doc.meta.cover.standfirst));
  titleChildren.push(...imageParagraphs(coverMedia ? (images.get(coverMedia.id) ?? null) : null, coverMedia, FULL_IMAGE_PX, coverMedia?.caption ?? null, creditOf(coverMedia)));
  for (const c of doc.meta.credits) titleChildren.push(para("Caption", `${c.role}: ${c.name}`));
  sections.push({ ...sectionProps(doc, SectionType.NEXT_PAGE), children: titleChildren });

  // ── Contents ────────────────────────────────────────────────────────────
  const contentsChildren: Paragraph[] = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text("Contents")] })];
  let currentSection = "";
  for (const line of doc.toc) {
    if (line.sectionName !== currentSection) {
      currentSection = line.sectionName;
      if (currentSection) contentsChildren.push(para("Crosshead", currentSection));
    }
    contentsChildren.push(
      new Paragraph({
        style: "Body",
        alignment: AlignmentType.LEFT,
        tabStops: [{ type: TabStopType.RIGHT, position: TEXT_WIDTH_TWIP, leader: LeaderType.DOT }],
        children: [text(line.text), new TextRun({ children: [new Tab(), `p. ${line.page}`], font: "Arial", size: 18, color: NAVY })],
      }),
    );
  }
  if (doc.meta.editorial) {
    contentsChildren.push(para("Crosshead", "Editorial"));
    for (const p of paragraphsOf(doc.meta.editorial)) contentsChildren.push(para("Body", p));
  }
  sections.push({ ...sectionProps(doc, SectionType.NEXT_PAGE), children: contentsChildren });

  // ── Articles ────────────────────────────────────────────────────────────
  let lastSectionId: string | null | undefined = undefined;
  for (const { article, sectionId } of ordered) {
    const section = sectionId ? sectionById.get(sectionId) : undefined;
    const sectionChanged = sectionId !== lastSectionId;
    lastSectionId = sectionId;
    const head: (Paragraph | Table)[] = [];
    if (sectionChanged && section) head.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text(section.name)] }));
    const kicker = article.kicker ?? section?.kicker ?? section?.name;
    if (kicker) head.push(para("Kicker", kicker));
    head.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [text(article.headline || article.storyTitle || "")] }));
    if (article.standfirst) head.push(para("Standfirst", article.standfirst));
    const metaBits = [article.campuses.join(" · "), article.eventDateText].filter(Boolean);
    if (metaBits.length) head.push(para("Caption", metaBits.join(" · ")));
    const heroId = article.heroMediaId;
    const hero = heroId ? mediaById.get(heroId) : undefined;
    if (hero && hero.rightsStatus !== "RED") head.push(...imageParagraphs(images.get(hero.id) ?? null, hero, FULL_IMAGE_PX));
    sections.push({ ...sectionProps(doc, sectionChanged ? SectionType.NEXT_PAGE : SectionType.CONTINUOUS), children: head });

    const twoColumns = article.wordCount > TWO_COLUMN_MIN_WORDS;
    const body: (Paragraph | Table)[] = [];
    article.body.forEach((block, i) => {
      const next = article.body[i + 1];
      const hideSpeaker = block.type === "testimony" && next?.type === "testimony" && (next.speaker ?? "") === (block.speaker ?? "");
      body.push(...blockParagraphs(block, { images, media: mediaById, numbering, imageWidth: twoColumns ? COLUMN_IMAGE_PX : FULL_IMAGE_PX, hideSpeaker }));
    });
    if (article.byline) body.push(para("Byline", `Article : ${article.byline}`));
    sections.push({ ...sectionProps(doc, SectionType.CONTINUOUS, twoColumns ? 2 : 1), children: body.length ? body : [para("Body", "")] });

    const tail: (Paragraph | Table)[] = [...bddParagraphs(article, numbering)];
    const gallery = article.media.filter((m) => m.role !== "cover" && m.mediaId !== heroId).map((m) => mediaById.get(m.mediaId)).filter((m): m is DocumentMedia => !!m && m.rightsStatus !== "RED");
    for (const media of gallery) tail.push(...imageParagraphs(images.get(media.id) ?? null, media, FULL_IMAGE_PX));
    if (tail.length) sections.push({ ...sectionProps(doc, SectionType.CONTINUOUS), children: tail });
  }

  // ── Colophon ────────────────────────────────────────────────────────────
  const colophon: Paragraph[] = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [text("Colophon")] })];
  for (const c of doc.meta.credits) colophon.push(para("Body", [text(`${c.role}: `, { bold: true }), text(c.name)], { alignment: AlignmentType.LEFT }));
  if (doc.meta.contactEmail) colophon.push(para("Body", [text("Contact: ", { bold: true }), text(doc.meta.contactEmail)], { alignment: AlignmentType.LEFT }));
  if (doc.meta.website) colophon.push(para("Body", [text("Website: ", { bold: true }), text(doc.meta.website)], { alignment: AlignmentType.LEFT }));
  if (doc.meta.social?.instagram) colophon.push(para("Body", [text("Instagram: ", { bold: true }), text(`@${doc.meta.social.instagram}`)], { alignment: AlignmentType.LEFT }));
  if (doc.references.length) {
    colophon.push(para("Crosshead", "References"));
    for (const ref of doc.references) {
      const article = articleById.get(ref.articleId);
      colophon.push(para("Caption", `${article?.headline ?? ref.articleId} — ${ref.url}`));
    }
  }
  colophon.push(para("Caption", `${doc.meta.masthead.title} · ${doc.meta.issueLabel} · version ${doc.meta.versionLabel} · generated ${formatIsoDate(doc.meta.generatedAt)}.`));
  sections.push({ ...sectionProps(doc, SectionType.NEXT_PAGE), children: colophon });

  const document = new Document({
    creator: doc.meta.masthead.title,
    lastModifiedBy: "Briefly",
    title: `${doc.meta.masthead.title} — ${doc.meta.issueLabel}, ${doc.meta.label}`,
    subject: doc.meta.issueLabel,
    description: `${doc.meta.title} · version ${doc.meta.versionLabel}`,
    keywords: [doc.meta.versionLabel, doc.meta.generatedAt, doc.meta.label, doc.meta.masthead.title].join(", "),
    styles: {
      default: { document: { run: { font: "Georgia", size: 21, color: "17191C" } } },
      paragraphStyles: [
        { id: "Title", name: "Title", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Georgia", size: 76, bold: true, color: NAVY }, paragraph: { spacing: { before: 2400, after: 120 } } },
        { id: "Subtitle", name: "Subtitle", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 22, color: GREY, allCaps: true, characterSpacing: 40 }, paragraph: { spacing: { after: 200 } } },
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Arial", size: 44, bold: true, color: NAVY, allCaps: true }, paragraph: { spacing: { before: 0, after: 360 }, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 6 } } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: "Georgia", size: 36, bold: true, color: NAVY }, paragraph: { spacing: { before: 120, after: 120 }, outlineLevel: 1, keepNext: true } },
        { id: "Kicker", name: "Kicker", basedOn: "Normal", next: "Normal", run: { font: "Arial", size: 16, bold: true, color: BLUE, allCaps: true, characterSpacing: 40 }, paragraph: { spacing: { before: 240, after: 60 }, keepNext: true } },
        { id: "Standfirst", name: "Standfirst", basedOn: "Normal", next: "Body", run: { font: "Georgia", size: 25, color: CHARCOAL }, paragraph: { spacing: { after: 160, line: 300 } } },
        { id: "Body", name: "Body", basedOn: "Normal", next: "Body", quickFormat: true, run: { font: "Georgia", size: 21 }, paragraph: { spacing: { after: 100, line: 276 }, alignment: AlignmentType.JUSTIFIED } },
        { id: "Crosshead", name: "Crosshead", basedOn: "Normal", next: "Body", run: { font: "Arial", size: 18, bold: true, allCaps: true, color: CHARCOAL, characterSpacing: 20 }, paragraph: { spacing: { before: 200, after: 60 }, keepNext: true } },
        { id: "PullQuote", name: "Pull Quote", basedOn: "Normal", next: "Body", run: { font: "Georgia", size: 28, italics: true, color: NAVY }, paragraph: { spacing: { before: 160, after: 160, line: 276 }, indent: { left: 567 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: BLUE, space: 10 } } } },
        { id: "Caption", name: "Caption", basedOn: "Normal", next: "Body", run: { font: "Arial", size: 16, color: GREY }, paragraph: { spacing: { after: 160 } } },
        { id: "Byline", name: "Byline", basedOn: "Normal", next: "Body", run: { font: "Arial", size: 16, bold: true, color: CHARCOAL }, paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 100, after: 240 } } },
        { id: "BoxTitle", name: "Box Title", basedOn: "Normal", next: "Body", run: { font: "Arial", size: 16, bold: true, allCaps: true, color: NAVY, characterSpacing: 30 }, paragraph: { spacing: { before: 120, after: 80 }, keepNext: true } },
        { id: "QAQuestion", name: "Q&A Question", basedOn: "Normal", next: "QAAnswer", run: { font: "Arial", size: 18, bold: true, allCaps: true, color: BLUE }, paragraph: { spacing: { before: 160, after: 40 }, keepNext: true } },
        { id: "QAAnswer", name: "Q&A Answer", basedOn: "Normal", next: "QAQuestion", run: { font: "Georgia", size: 21 }, paragraph: { spacing: { after: 100, line: 276 }, alignment: AlignmentType.JUSTIFIED } },
        { id: "Testimony", name: "Testimony", basedOn: "Normal", next: "Body", run: { font: "Georgia", size: 21, italics: true }, paragraph: { spacing: { after: 80, line: 276 }, indent: { left: 400 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 8 } } } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 567, hanging: 283 } } } }] },
        { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 567, hanging: 283 } } } }] },
      ],
    },
    sections,
  });
  const buffer = await Packer.toBuffer(document);
  say("docx rendered", "info", { bytes: buffer.length, articles: ordered.length, sections: sections.length });
  return buffer;
}

/** Unzips the DOCX and checks that word/document.xml is well-formed XML (and optionally contains `mustContain`). */
export function verifyDocx(buffer: Buffer, mustContain?: string): { ok: boolean; error?: string; documentXml: string } {
  let documentXml = "";
  try {
    const entry = readZipEntry(buffer, "word/document.xml");
    if (!entry) return { ok: false, error: "word/document.xml missing", documentXml };
    documentXml = entry.toString("utf8");
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), documentXml };
  }
  const xml = checkXmlWellFormed(documentXml);
  if (!xml.ok) return { ok: false, error: xml.error, documentXml };
  if (mustContain && !documentXml.includes(escapeXmlText(mustContain))) return { ok: false, error: `document.xml does not contain "${mustContain}"`, documentXml };
  return { ok: true, documentXml };
}

function escapeXmlText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
