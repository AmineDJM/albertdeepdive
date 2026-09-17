import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import { runAsOrganization } from "@/server/tenancy/context";
import { confirmSubscription, publicationBySubscribeSlug, recipientsFor, subscribe, subscriberStats, unsubscribe } from "@/server/subscribers/service";
import { applyPublicationDefaults, disableOutput, enableOutput, outputMatrix, setOutputStatus } from "@/server/outputs/service";
import { createEdition } from "@/server/editions/service";
import { NotFoundError, ValidationError } from "@/lib/action-result";

describe("subscriptions", () => {
  let organizationId: string;
  let publicationId: string;

  beforeAll(async () => {
    await ensureSeeded();
    const org = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") });
    organizationId = org!.id;
    const pub = await db.query.publications.findFirst({ where: eq(s.publications.organizationId, organizationId) });
    publicationId = pub!.id;
  });

  it("finds a title by its public subscribe slug", async () => {
    const found = await publicationBySubscribeSlug("albert-deep-dive");
    expect(found?.id).toBe(publicationId);
    expect(await publicationBySubscribeSlug("nope")).toBeNull();
  });

  it("does not send to anyone who has not confirmed", async () => {
    const result = await subscribe(publicationId, { email: "Reader@Example.com", firstName: "Rea" });
    expect(result.status).toBe("confirmation_sent");
    expect(result.confirmToken).toBeTruthy();

    const row = await db.query.subscribers.findFirst({ where: eq(s.subscribers.id, result.subscriberId) });
    expect(row?.status).toBe("PENDING");
    expect(row?.email).toBe("reader@example.com"); // normalised
    expect(row?.confirmTokenHash).not.toBe(result.confirmToken); // stored hashed, never in the clear

    const recipients = await recipientsFor(publicationId);
    expect(recipients.map((r) => r.email)).not.toContain("reader@example.com");

    await confirmSubscription(result.confirmToken!);
    const after = await db.query.subscribers.findFirst({ where: eq(s.subscribers.id, result.subscriberId) });
    expect(after?.status).toBe("SUBSCRIBED");
    expect(after?.confirmTokenHash).toBeNull(); // single use
    expect((await recipientsFor(publicationId)).map((r) => r.email)).toContain("reader@example.com");
  });

  it("refuses a confirmation token that has already been used or was never issued", async () => {
    const result = await subscribe(publicationId, { email: "twice@example.com" });
    await confirmSubscription(result.confirmToken!);
    await expect(confirmSubscription(result.confirmToken!)).rejects.toBeInstanceOf(NotFoundError);
    await expect(confirmSubscription("made-up-token")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("says the same thing to a stranger whether or not the address is already on the list", async () => {
    // Otherwise the form becomes a way of asking "does this person read this publication?".
    const first = await subscribe(publicationId, { email: "known@example.com" });
    await confirmSubscription(first.confirmToken!);
    const second = await subscribe(publicationId, { email: "known@example.com" });
    expect(second.status).toBe("already_subscribed");
    expect(second.subscriberId).toBe(first.subscriberId);
  });

  it("unsubscribes in one click and stops sending", async () => {
    const result = await subscribe(publicationId, { email: "leaving@example.com" });
    await confirmSubscription(result.confirmToken!);
    const row = await db.query.subscribers.findFirst({ where: eq(s.subscribers.id, result.subscriberId) });

    await unsubscribe(row!.unsubscribeToken);
    const after = await db.query.subscribers.findFirst({ where: eq(s.subscribers.id, result.subscriberId) });
    expect(after?.status).toBe("UNSUBSCRIBED");
    expect((await recipientsFor(publicationId)).map((r) => r.email)).not.toContain("leaving@example.com");

    const link = await db.query.publicationSubscriptions.findFirst({
      where: and(eq(s.publicationSubscriptions.publicationId, publicationId), eq(s.publicationSubscriptions.subscriberId, result.subscriberId)),
    });
    expect(link?.isActive).toBe(false);
    await expect(unsubscribe("not-a-token")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("treats coming back as a fresh consent", async () => {
    const first = await subscribe(publicationId, { email: "returning@example.com" });
    await confirmSubscription(first.confirmToken!);
    const row = await db.query.subscribers.findFirst({ where: eq(s.subscribers.id, first.subscriberId) });
    await unsubscribe(row!.unsubscribeToken);

    const again = await subscribe(publicationId, { email: "returning@example.com" });
    expect(again.status).toBe("confirmation_sent");
    const pending = await db.query.subscribers.findFirst({ where: eq(s.subscribers.id, first.subscriberId) });
    expect(pending?.status).toBe("PENDING");
    expect((await recipientsFor(publicationId)).map((r) => r.email)).not.toContain("returning@example.com");
  });

  it("counts readers by standing", async () => {
    const stats = await subscriberStats(organizationId);
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.subscribed + stats.pending + stats.unsubscribed + stats.bounced).toBe(stats.total);
  });
});

describe("edition outputs", () => {
  let organizationId: string;
  let editionId: string;

  beforeAll(async () => {
    await ensureSeeded();
    const org = await db.query.organizations.findFirst({ where: eq(s.organizations.slug, "albert-school") });
    organizationId = org!.id;
    const edition = await runAsOrganization(organizationId, () => createEdition({ month: 7, year: 2031, title: "Outputs test", targetPageCount: 8 }, null));
    editionId = edition.id;
  });

  it("starts a new edition with its title's usual formats", async () => {
    // The seeded title publishes as a magazine and an email.
    const matrix = await outputMatrix(editionId);
    const enabled = matrix.filter((m) => m.output).map((m) => m.format).sort();
    expect(enabled).toEqual(["EMAIL", "MAGAZINE"]);
    expect(matrix.find((m) => m.format === "WEB")?.output).toBeNull();
  });

  it("adds and removes a format, and is idempotent", async () => {
    const first = await runAsOrganization(organizationId, () => enableOutput(editionId, "WEB"));
    const second = await runAsOrganization(organizationId, () => enableOutput(editionId, "WEB"));
    expect(second.id).toBe(first.id);
    expect(first.publicSlug).toBeTruthy();

    await runAsOrganization(organizationId, () => disableOutput(editionId, "WEB"));
    expect((await outputMatrix(editionId)).find((m) => m.format === "WEB")?.output).toBeNull();
  });

  it("refuses to remove a format that has already been published", async () => {
    const output = await runAsOrganization(organizationId, () => enableOutput(editionId, "PRINT"));
    await setOutputStatus(output.id, "PUBLISHED", { publishedAt: new Date() });
    await expect(runAsOrganization(organizationId, () => disableOutput(editionId, "PRINT"))).rejects.toBeInstanceOf(ValidationError);
  });

  it("applies defaults without duplicating what is already there", async () => {
    const before = (await outputMatrix(editionId)).filter((m) => m.output).length;
    await runAsOrganization(organizationId, () => applyPublicationDefaults(editionId));
    expect((await outputMatrix(editionId)).filter((m) => m.output).length).toBe(before);
  });
});
