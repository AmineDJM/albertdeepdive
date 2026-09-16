import { describe, expect, it } from "vitest";
import { draftPatchSchema, extraSchemaFor, validateSubmissionPayload } from "@/lib/submissions/schemas";

const base = {
  storyType: "CAMPUS_LIFE",
  title: "Marseille tops the maths test again",
  campusIds: [],
  description: "The Marseille campus scored the highest average at the mid-term maths test for the second year running.",
  publicationConsent: true,
};

describe("validateSubmissionPayload", () => {
  it("accepts a minimal valid story and normalises links", () => {
    const result = validateSubmissionPayload({ ...base, urls: ["albertschool.com/news", "", "  "] }, { hasPhotos: false });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.urls).toEqual(["https://albertschool.com/news"]);
      expect(result.data.campusIds).toEqual([]);
      expect(result.data.extra).toEqual({});
    }
  });

  it("requires a title, a description and the publication consent", () => {
    const result = validateSubmissionPayload({ storyType: "OTHER", title: "Hi", description: "Too short", publicationConsent: false }, { hasPhotos: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.fieldErrors).sort()).toEqual(["description", "publicationConsent", "title"]);
    }
  });

  it("requires image rights only when photos are attached", () => {
    const withoutPhotos = validateSubmissionPayload(base, { hasPhotos: false });
    expect(withoutPhotos.ok).toBe(true);
    const withPhotos = validateSubmissionPayload(base, { hasPhotos: true });
    expect(withPhotos.ok).toBe(false);
    if (!withPhotos.ok) expect(withPhotos.fieldErrors.imageRightsConfirmed).toBeDefined();
    expect(validateSubmissionPayload({ ...base, imageRightsConfirmed: true }, { hasPhotos: true }).ok).toBe(true);
  });

  it("requires company and winning team for a Business Deep Dive", () => {
    const missing = validateSubmissionPayload({ ...base, storyType: "BUSINESS_DEEP_DIVE", extra: { cohort: "B2 Paris" } }, { hasPhotos: false });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.fieldErrors["extra.company"]).toEqual(["Company is required"]);
      expect(missing.fieldErrors["extra.winningTeam"]).toEqual(["Winning team is required"]);
    }
    const ok = validateSubmissionPayload(
      { ...base, storyType: "BUSINESS_DEEP_DIVE", extra: { company: "Carrefour", winningTeam: "Anna Spira\nSacha Nardoux", technologies: "LightGBM", unknownKey: "dropped" } },
      { hasPhotos: false },
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.extra.company).toBe("Carrefour");
      expect(ok.data.extra).not.toHaveProperty("unknownKey");
    }
  });

  it("requires at least one source for a data / AI / business insight", () => {
    const missing = validateSubmissionPayload({ ...base, storyType: "DATA_AI_BUSINESS_INSIGHT", extra: { sourceUrls: [] } }, { hasPhotos: false });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.fieldErrors["extra.sourceUrls"]).toEqual(["Sources is required"]);
    const invalid = validateSubmissionPayload({ ...base, storyType: "DATA_AI_BUSINESS_INSIGHT", extra: { sourceUrls: ["not a url"] } }, { hasPhotos: false });
    expect(invalid.ok).toBe(false);
    const ok = validateSubmissionPayload({ ...base, storyType: "DATA_AI_BUSINESS_INSIGHT", extra: { sourceUrls: ["https://www.ft.com/some-article"] } }, { hasPhotos: false });
    expect(ok.ok).toBe(true);
  });

  it("validates optional urls in extra fields", () => {
    expect(extraSchemaFor("STUDENT_PROJECT").safeParse({ projectName: "KÆRN", website: "" }).success).toBe(true);
    expect(extraSchemaFor("STUDENT_PROJECT").safeParse({ projectName: "KÆRN", website: "kaern.fr" }).data?.website).toBe("https://kaern.fr");
    expect(extraSchemaFor("STUDENT_PROJECT").safeParse({ projectName: "" }).success).toBe(false);
  });

  it("rejects an invalid contact email but accepts an empty one", () => {
    expect(validateSubmissionPayload({ ...base, contactEmail: "nope" }, { hasPhotos: false }).ok).toBe(false);
    expect(validateSubmissionPayload({ ...base, contactEmail: "" }, { hasPhotos: false }).ok).toBe(true);
  });
});

describe("draftPatchSchema", () => {
  it("accepts partial, unfinished data", () => {
    const parsed = draftPatchSchema.safeParse({ title: "H", description: "", urls: ["not yet a url"], extra: { company: "C" }, ignored: 1 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).not.toHaveProperty("ignored");
  });

  it("rejects wrong types", () => {
    expect(draftPatchSchema.safeParse({ campusIds: "paris" }).success).toBe(false);
    expect(draftPatchSchema.safeParse({ storyType: "NOPE" }).success).toBe(false);
  });
});
