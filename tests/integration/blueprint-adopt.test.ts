import { afterAll, beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { activeIdentity } from "@/server/design/identity";
import { adoptBlueprint, dialsFromEvidence, proposeFromBrand, proposeFromFile, rubricsFromEvidence } from "@/server/design/blueprint/service";
import { emptyEvidence } from "@/lib/design/blueprint";

/**
 * "Here is our newsletter — make ours look like this."
 *
 * The whole point of reading somebody's file is that the next issue is recognisably theirs, so the
 * test is about what survives the trip: the page, the palette, the type and the rubrics in their
 * own language. And what must not survive: a single word of last month's copy.
 *
 * It runs with no model connected, which is the harder case and the one that has to be honest —
 * everything asserted here was measured out of the file, and the reading says so itself.
 */
describe("adopting a blueprint", () => {
  let publicationId: string;
  let userId: string;
  let restore: typeof s.publicationIdentities.$inferSelect | null = null;

  const THEME = `<a:theme xmlns:a="x"><a:themeElements>
    <a:clrScheme name="Acme"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:accent1><a:srgbClr val="C8102E"/></a:accent1><a:accent2><a:srgbClr val="00539B"/></a:accent2></a:clrScheme>
    <a:fontScheme name="Acme"><a:majorFont><a:latin typeface="Playfair Display"/></a:majorFont><a:minorFont><a:latin typeface="Source Sans Pro"/></a:minorFont></a:fontScheme>
  </a:themeElements></a:theme>`;

  async function lastMonth(): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("word/theme/theme1.xml", THEME);
    zip.file("docProps/app.xml", "<Properties><Pages>6</Pages><Words>2400</Words></Properties>");
    zip.file(
      "word/document.xml",
      `<w:document><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Édito</w:t></w:r></w:p>
        <w:p><w:r><w:t>Marie Dupont a remporté le prix régional cette année.</w:t></w:r></w:p>
        <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Les chiffres du mois</w:t></w:r></w:p>
        <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Portrait</w:t></w:r></w:p>
        <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1417" w:left="1134"/></w:sectPr>
      </w:body></w:document>`,
    );
    return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
  }

  beforeAll(async () => {
    await ensureSeeded();
    const publication = await db.query.publications.findFirst();
    publicationId = publication!.id;
    userId = (await db.query.users.findFirst({ where: eq(s.users.role, "SUPER_ADMIN") }))!.id;
    restore = (await db.query.publicationIdentities.findFirst({ where: eq(s.publicationIdentities.publicationId, publicationId) })) ?? null;
  });

  afterAll(async () => {
    await db.delete(s.publicationIdentities).where(eq(s.publicationIdentities.publicationId, publicationId));
    if (restore) await db.insert(s.publicationIdentities).values(restore);
  });

  it("reads a Word newsletter into a proposal that keeps the shape and drops the words", async () => {
    const proposal = await proposeFromFile(publicationId, await lastMonth(), "lettre-octobre.docx");
    expect(proposal.kind).toBe("docx");
    expect(proposal.fileName).toBe("lettre-octobre.docx");
    expect(proposal.readBy).toBe("measured");

    // The palette and the type, offered for the workspace brand rather than folded in silently.
    expect(proposal.brand?.palette.brand).toBe("#c8102e");
    expect(proposal.brand?.fonts.heading).toBe("Playfair Display");
    expect(proposal.brand?.fonts.body).toBe("Source Sans Pro");

    // The rubrics, in French, because they are this title's words.
    expect(proposal.rubrics.map((rubric) => rubric.name)).toEqual(["Édito", "Les chiffres du mois", "Portrait"]);

    // And not one word of last month's news anywhere in what would be saved.
    expect(JSON.stringify(proposal.identity) + JSON.stringify(proposal.rubrics)).not.toContain("Marie Dupont");
    expect(proposal.notes.join(" ")).toMatch(/no model is connected|could not be completed/i);
  });

  it("writes it onto the title as a new version, with an account of where it came from", async () => {
    const proposal = await proposeFromFile(publicationId, await lastMonth(), "lettre-octobre.docx");
    const before = await activeIdentity(publicationId);
    const identity = await adoptBlueprint(publicationId, proposal, userId);

    expect(identity.version).toBeGreaterThan(before.version - 1);
    expect(identity.rubrics.map((rubric) => rubric.name)).toEqual(["Édito", "Les chiffres du mois", "Portrait"]);
    expect(identity.source?.kind).toBe("uploaded");
    expect(identity.source?.fileName).toBe("lettre-octobre.docx");
    expect(identity.source?.readBy).toBe("measured");
    expect(identity.source?.at).toBeTruthy();
    // The title keeps its own name: a blueprint is a shape, not a rename.
    expect(identity.name).toBe(before.name);

    const reread = await activeIdentity(publicationId);
    expect(reread.rubrics).toHaveLength(3);
  });

  it("designs one from the brand when there is no file", async () => {
    const proposal = await proposeFromBrand(publicationId, [
      { name: "Le mot de la rédaction", component: "editors-note" },
      { name: "Les chiffres", component: "numbers" },
    ]);
    expect(proposal.kind).toBe("brand");
    expect(proposal.fileName).toBeNull();
    expect(proposal.identity.masthead).toBeTruthy();
    const identity = await adoptBlueprint(publicationId, proposal, userId);
    expect(identity.source?.kind).toBe("brand");
    // The components Briefly knows how to compose are carried across; the names stay theirs.
    expect(identity.recurring).toEqual(expect.arrayContaining(["editors-note", "numbers"]));
    expect(identity.rubrics[0].name).toBe("Le mot de la rédaction");
  });

  it("only moves the dials a file's own numbers support", () => {
    const evidence = emptyEvidence("pdf");
    evidence.colours = [
      { hex: "#c8102e", weight: 0.3, where: "text" },
      { hex: "#111111", weight: 0.7, where: "text" },
    ];
    evidence.page = { widthPt: 595, heightPt: 842, orientation: "portrait", margins: null };
    evidence.counts = { pages: 4, words: 3200, images: 8, headings: 6 };
    const dials = dialsFromEvidence(evidence);
    expect(dials.colourIntensity).toBeGreaterThan(0);
    expect(dials.density).toBeGreaterThan(0.5); // 800 words on an A4 page is dense
    expect(dials.imageUsage).toBe("led"); // two pictures a page
    // Judgement is not measurement: nothing here says how playful or how formal the thing is.
    expect(dials.playfulness).toBeUndefined();
    expect(dials.formality).toBeUndefined();
    expect(dials.variation).toBeUndefined();
  });

  it("falls back to the headings that repeat, and says they are only that", () => {
    const evidence = emptyEvidence("pdf");
    evidence.outline = [
      { level: 1, text: "Édito", occurrences: 3 },
      { level: 1, text: "Marie Dupont remporte le prix régional", occurrences: 1 },
      { level: 2, text: "Les chiffres", occurrences: 3 },
    ];
    expect(rubricsFromEvidence(evidence).map((rubric) => rubric.name)).toEqual(["Édito", "Les chiffres"]);
  });
});
