import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { buildEditionDocument } from "@/server/publication/document-builder";
import { designEmailFor } from "@/server/design/email";
import { designEdition } from "@/server/design/service";
import { runQc } from "@/server/qc";
import type { RenderedEmail } from "@/server/design/render/email";
import type { EditionDocument } from "@/lib/publication/document";

/**
 * The email an edition actually sends.
 *
 * Rendered from a real edition's design, because the failures email is famous for only appear with
 * real material: a message over Gmail's clipping limit, a picture whose URL never resolved, a
 * story the design placed and the email forgot. The send path chooses this renderer only for an
 * edition that has been designed, so both halves of that switch are checked here too.
 */
describe("sending a designed edition", () => {
  let email: RenderedEmail;
  let doc: EditionDocument;
  let editionId: string;
  let organizationId: string;
  let undesignedId: string;

  beforeAll(async () => {
    const seeded = await ensureSeeded();
    editionId = seeded.editionId;
    undesignedId = seeded.nextEditionId;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    organizationId = edition!.organizationId!;

    await runAsOrganization(organizationId, async () => {
      await designEdition(editionId, { local: true });
      doc = await buildEditionDocument(editionId, { versionLabel: "email", includeUnapproved: true });
      const render = await designEmailFor(editionId, {
        document: doc,
        imageUrls: Object.fromEntries(doc.media.map((media) => [media.id, `https://cdn.example.test/${media.id}.jpg`])),
        organizationName: "Albert School",
        webUrl: "https://example.test/r/issue",
        locale: "en",
      });
      email = render!({ unsubscribeUrl: "https://example.test/s/unsubscribe/token", greetingName: "Camille" });
    });
  }, 300_000);

  it("renders the design rather than re-deriving the edition", () => {
    expect(email.subject.length).toBeGreaterThan(3);
    expect(email.html).toContain("Camille");
    expect(email.html).toContain("https://example.test/s/unsubscribe/token");
    expect(email.html).toContain('role="presentation"');
  });

  it("stays under the size at which Gmail cuts a message in half", () => {
    expect(email.bytes).toBeLessThan(102_000);
    // And if it had to drop anything, it says how much rather than stopping mid-issue.
    if (email.dropped.length) expect(email.html).toContain(`more in this edition`);
  });

  it("leads with something an editor chose", () => {
    const leadHeadlines = doc.articles.slice(0, 3).map((article) => article.headline);
    expect(leadHeadlines.some((headline) => email.html.includes(headline) || email.subject === headline)).toBe(true);
  });

  it("points every picture at a URL an inbox can fetch", () => {
    for (const source of [...email.html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((match) => match[1])) {
      expect(source.startsWith("https://"), `${source} would not load in an inbox`).toBe(true);
    }
  });

  it("carries nothing a renderer failed to fill in", () => {
    expect(email.html).not.toContain("undefined");
    expect(email.html).not.toContain("[object Object]");
    expect(email.html).not.toContain("NaN");
    expect(email.text).not.toContain("undefined");
  });

  it("passes the email checks the quality engine already enforces", async () => {
    const report = await runAsOrganization(organizationId, () => runQc(editionId, { profile: "EMAIL", only: ["email"], repair: false, persist: false }));
    // A check that did not run is not a check that passed, so prove it ran before believing it.
    expect(report.skipped.map((entry) => entry.check)).not.toContain("email");
    const measured = report.passed.filter((entry) => entry.metricId.startsWith("email."));
    expect(measured.map((entry) => entry.metricId)).toContain("email.unsubscribe");
    expect(measured.length).toBeGreaterThan(2);

    const failures = report.findings.filter((finding) => finding.metricId.startsWith("email."));
    expect(failures.map((finding) => `${finding.metricId}: ${finding.actual} (wanted ${finding.expected})`)).toEqual([]);
  }, 180_000);

  it("leaves an edition that has never been designed to the renderer it has always used", async () => {
    const other = await runAsOrganization(organizationId, async () => {
      const document = await buildEditionDocument(undesignedId, { versionLabel: "email", includeUnapproved: true });
      return designEmailFor(undesignedId, { document, imageUrls: {}, organizationName: "Albert School" });
    });
    expect(other).toBeNull();
  }, 120_000);
});
