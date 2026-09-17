import { beforeAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { confirmSubscription, subscribe } from "@/server/subscribers/service";
import { enableOutput } from "@/server/outputs/service";
import { publishWebEdition, sendEditionEmail } from "@/server/outputs/publish";
import { ValidationError } from "@/lib/action-result";

/**
 * The send is the moment the product is judged: a broken email is public and permanent. This walks
 * the whole path — subscribe, confirm, send — and then reads what actually left the building.
 */
describe("sending an edition", () => {
  let organizationId: string;
  let editionId: string;
  let publicationId: string;

  beforeAll(async () => {
    await ensureSeeded();
    const org = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") });
    organizationId = org!.id;
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.organizationId, organizationId), orderBy: [s.editions.issueNumber] });
    editionId = edition!.id;
    publicationId = edition!.publicationId!;

    await runAsOrganization(organizationId, async () => {
      await enableOutput(editionId, "EMAIL");
      await enableOutput(editionId, "WEB");
      await publishWebEdition(editionId);
    });
  });

  it("refuses to send when nobody has confirmed", async () => {
    await expect(sendEditionEmail(editionId)).rejects.toBeInstanceOf(ValidationError);
    const output = await db.query.editionOutputs.findFirst({ where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, "EMAIL")) });
    expect(output?.status).toBe("FAILED");
  });

  it("sends one message per confirmed reader, each with its own unsubscribe link", async () => {
    for (const email of ["one@example.com", "two@example.com"]) {
      const result = await subscribe(publicationId, { email });
      await confirmSubscription(result.confirmToken!);
    }

    const result = await sendEditionEmail(editionId);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);

    const sentRows = await db.query.emailLog.findMany({
      where: and(eq(s.emailLog.editionId, editionId), eq(s.emailLog.template, "edition_email")),
      orderBy: [desc(s.emailLog.createdAt)],
    });
    expect(sentRows).toHaveLength(2);

    const tokens = new Set<string>();
    for (const row of sentRows) {
      expect(row.organizationId).toBe(organizationId);
      const match = row.html.match(/\/s\/unsubscribe\/([A-Za-z0-9_-]+)/);
      expect(match, "every email carries an unsubscribe link").toBeTruthy();
      tokens.add(match![1]);
    }
    // A shared link would let any reader unsubscribe every other reader.
    expect(tokens.size).toBe(2);
  });

  it("renders a real digest, not a template shell", async () => {
    const row = await db.query.emailLog.findFirst({
      where: and(eq(s.emailLog.editionId, editionId), eq(s.emailLog.template, "edition_email")),
      orderBy: [desc(s.emailLog.createdAt)],
    });
    const html = row!.html;
    expect(html.startsWith("<!doctype html")).toBe(true);
    // One document, not a layout wrapped around another layout.
    expect(html.match(/<html/g)).toHaveLength(1);
    expect(html).toContain("Albert School");
    expect(html).toContain("Read the whole edition"); // the web edition is published, so it links to it
    expect(html).not.toContain("<script");
    expect(row!.textBody).toContain("Unsubscribe:");
    // The cover story leads.
    const edition = await db.query.editions.findFirst({ where: eq(s.editions.id, editionId) });
    if (edition?.coverHeadline) expect(row!.subject).toBe(edition.coverHeadline);
  });

  it("will not send the same edition twice", async () => {
    await expect(sendEditionEmail(editionId)).rejects.toBeInstanceOf(ValidationError);
  });

  it("records who it reached", async () => {
    const output = await db.query.editionOutputs.findFirst({ where: and(eq(s.editionOutputs.editionId, editionId), eq(s.editionOutputs.format, "EMAIL")) });
    expect(output?.status).toBe("PUBLISHED");
    expect(output?.recipientCount).toBe(2);
    expect(output?.deliveredCount).toBe(2);
    expect(output?.publishedAt).toBeTruthy();
  });
});
