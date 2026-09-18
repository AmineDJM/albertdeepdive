import { describe, expect, it } from "vitest";
import { LanguageUnknownError, baseLanguage, detectLanguage, resolveNarrationLanguage } from "@/lib/speech/language";

const FRENCH = "Cette année, les étudiants de la promotion ont présenté leurs projets devant un jury composé de professionnels. Les résultats sont impressionnants et nous sommes fiers de ce que les équipes ont accompli avec leurs partenaires.";
const ENGLISH = "This year the students of the cohort presented their projects to a jury of professionals. The results are impressive and we are proud of what the teams have achieved together with their partners.";
const SPANISH = "Este año los estudiantes de la promoción presentaron sus proyectos ante un jurado de profesionales. Los resultados son impresionantes y estamos orgullosos de lo que los equipos han logrado con sus socios.";
const GERMAN = "In diesem Jahr haben die Studierenden des Jahrgangs ihre Projekte vor einer Jury aus Fachleuten vorgestellt. Die Ergebnisse sind beeindruckend und wir sind stolz auf das, was die Teams mit ihren Partnern erreicht haben.";

describe("telling languages apart", () => {
  it("recognises the languages Briefly speaks", () => {
    expect(detectLanguage(FRENCH).language).toBe("fr");
    expect(detectLanguage(ENGLISH).language).toBe("en");
    expect(detectLanguage(SPANISH).language).toBe("es");
    expect(detectLanguage(GERMAN).language).toBe("de");
  });

  it("does not guess from a headline", () => {
    expect(detectLanguage("Data").language).toBeNull();
    expect(detectLanguage("Albert School 2026").language).toBeNull();
  });

  it("reads a locale tag down to its language", () => {
    expect(baseLanguage("fr-FR")).toBe("fr");
    expect(baseLanguage("en_GB")).toBe("en");
    expect(baseLanguage("xx")).toBeNull();
  });
});

describe("deciding the language of a narration", () => {
  it("does what it was asked", () => {
    expect(resolveNarrationLanguage({ requested: "en", text: FRENCH, publication: "fr" })).toMatchObject({ language: "en", source: "requested" });
  });

  it("follows the publication when the words agree", () => {
    expect(resolveNarrationLanguage({ text: FRENCH, publication: "fr" })).toMatchObject({ language: "fr", source: "publication" });
  });

  it("trusts the words over a declaration they clearly contradict", () => {
    // A French title with an English article in it is read in English, whatever the title says.
    const twice = `${ENGLISH} ${ENGLISH}`;
    expect(resolveNarrationLanguage({ text: twice, publication: "fr", workspace: "fr" })).toMatchObject({ language: "en", source: "detected" });
  });

  it("keeps the declaration when the words are too few to be sure", () => {
    expect(resolveNarrationLanguage({ text: "Data and AI: the results.", publication: "fr" })).toMatchObject({ language: "fr", source: "publication" });
  });

  it("never falls back to English on its own", () => {
    expect(() => resolveNarrationLanguage({ text: "Data" })).toThrow(LanguageUnknownError);
    expect(resolveNarrationLanguage({ text: "Data", workspace: "fr" })).toMatchObject({ language: "fr", source: "workspace" });
  });
});
