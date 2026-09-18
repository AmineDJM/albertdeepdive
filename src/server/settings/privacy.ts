/**
 * Privacy & retention: contributor data export (GDPR access request) and retention figures.
 */
import { asc, desc, eq, ilike, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "@/server/audit";
import { NotFoundError } from "@/lib/action-result";

/** Everything the newsroom holds about one contributor, as a JSON document. */
export async function exportContributorData(email: string, actorId?: string | null): Promise<{ contributorId: string; fileName: string; json: string }> {
  const needle = email.trim();
  if (!needle) throw new NotFoundError("Contributor");
  const contributor = await db.query.contributors.findFirst({ where: ilike(s.contributors.email, needle), with: { campus: true, program: true, groupMemberships: { with: { group: true } } } });
  if (!contributor) throw new NotFoundError("Contributor");
  const submissions = await db.query.submissions.findMany({
    where: eq(s.submissions.contributorId, contributor.id),
    orderBy: [desc(s.submissions.createdAt)],
    with: { edition: { columns: { label: true, issueNumber: true } }, attachments: true, campuses: { with: { campus: { columns: { name: true } } } } },
  });
  const requests = await db.query.submissionRequests.findMany({
    where: eq(s.submissionRequests.contributorId, contributor.id),
    orderBy: [desc(s.submissionRequests.createdAt)],
    with: { campaign: { columns: { name: true }, with: { edition: { columns: { label: true } } } } },
  });
  const consents = await db.select().from(s.consentRecords).where(eq(s.consentRecords.contributorId, contributor.id)).orderBy(desc(s.consentRecords.acceptedAt));
  const emails = await db
    .select({ id: s.emailLog.id, to: s.emailLog.to, subject: s.emailLog.subject, template: s.emailLog.template, status: s.emailLog.status, sentAt: s.emailLog.sentAt, createdAt: s.emailLog.createdAt, editionLabel: s.editions.label })
    .from(s.emailLog)
    .leftJoin(s.editions, eq(s.editions.id, s.emailLog.editionId))
    .where(eq(s.emailLog.contributorId, contributor.id))
    .orderBy(desc(s.emailLog.createdAt));
  const infoRequests = await db
    .select({ id: s.informationRequests.id, message: s.informationRequests.message, status: s.informationRequests.status, answerText: s.informationRequests.answerText, sentAt: s.informationRequests.sentAt, answeredAt: s.informationRequests.answeredAt })
    .from(s.informationRequests)
    .where(eq(s.informationRequests.contributorId, contributor.id))
    .orderBy(desc(s.informationRequests.createdAt));
  const media = await db
    .select({ id: s.mediaAssets.id, fileName: s.mediaAssets.fileName, caption: s.mediaAssets.caption, photographer: s.mediaAssets.photographer, credit: s.mediaAssets.credit, rightsStatus: s.mediaAssets.rightsStatus, createdAt: s.mediaAssets.createdAt })
    .from(s.mediaAssets)
    .where(eq(s.mediaAssets.uploadedByContributorId, contributor.id))
    .orderBy(asc(s.mediaAssets.createdAt));
  const people = contributor.id
    ? await db.select({ id: s.people.id, fullName: s.people.fullName, role: s.people.role, mentionsCount: s.people.mentionsCount }).from(s.people).where(eq(s.people.contributorId, contributor.id))
    : [];
  const submissionIds = submissions.map((sub) => sub.id);
  const submissionConsents = submissionIds.length ? await db.select().from(s.consentRecords).where(inArray(s.consentRecords.submissionId, submissionIds)) : [];

  const document = {
    exportedAt: new Date().toISOString(),
    scope: "Personal data held by Briefly about one contributor (GDPR art. 15)",
    contributor: {
      id: contributor.id,
      firstName: contributor.firstName,
      lastName: contributor.lastName,
      email: contributor.email,
      type: contributor.type,
      campus: contributor.campus?.name ?? null,
      program: contributor.program?.name ?? null,
      organisationName: contributor.organisationName,
      preferredLanguage: contributor.preferredLanguage,
      tags: contributor.tags,
      notes: contributor.notes,
      groups: contributor.groupMemberships.map((m) => m.group.name),
      invitationsCount: contributor.invitationsCount,
      submissionsCount: contributor.submissionsCount,
      responseRate: contributor.responseRate,
      lastInvitedAt: contributor.lastInvitedAt,
      lastContributionAt: contributor.lastContributionAt,
      createdAt: contributor.createdAt,
      isActive: contributor.isActive,
    },
    submissions: submissions.map((sub) => ({
      id: sub.id,
      edition: sub.edition.label,
      title: sub.title,
      storyType: sub.storyType,
      status: sub.status,
      description: sub.description,
      peopleInvolved: sub.peopleInvolved,
      organisationsInvolved: sub.organisationsInvolved,
      whyItMatters: sub.whyItMatters,
      quotes: sub.quotes,
      urls: sub.urls,
      contactName: sub.contactName,
      contactEmail: sub.contactEmail,
      campuses: sub.campuses.map((c) => c.campus.name),
      publicationConsent: sub.publicationConsent,
      imageRightsConfirmed: sub.imageRightsConfirmed,
      consentTextVersion: sub.consentTextVersion,
      submittedAt: sub.submittedAt,
      attachments: sub.attachments.map((a) => ({ fileName: a.fileName, kind: a.kind, caption: a.caption, photographer: a.photographer, sizeBytes: a.sizeBytes })),
    })),
    campaignRequests: requests.map((r) => ({ edition: r.campaign.edition.label, campaign: r.campaign.name, status: r.status, sentAt: r.sentAt, openedAt: r.openedAt, submittedAt: r.submittedAt, remindedCount: r.remindedCount })),
    consentRecords: [...consents, ...submissionConsents.filter((c) => !consents.some((k) => k.id === c.id))].map((c) => ({ type: c.type, textVersion: c.textVersion, accepted: c.accepted, acceptedAt: c.acceptedAt, revokedAt: c.revokedAt, submissionId: c.submissionId, mediaAssetId: c.mediaAssetId })),
    emails,
    informationRequests: infoRequests,
    uploadedMedia: media,
    peopleRecords: people,
  };
  await audit({ action: "privacy.export", userId: actorId, entityType: "CONTRIBUTOR", entityId: contributor.id, metadata: { submissions: submissions.length, emails: emails.length } });
  const safeName = `${contributor.firstName}-${contributor.lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return { contributorId: contributor.id, fileName: `contributor-${safeName}-${new Date().toISOString().slice(0, 10)}.json`, json: JSON.stringify(document, null, 2) };
}

/** What the retention policy would touch today. */
export async function retentionSummary(retentionDays: number) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const [emails] = await db.select({ n: sql<number>`count(*)` }).from(s.emailLog).where(lt(s.emailLog.createdAt, cutoff));
  const [auditRows] = await db.select({ n: sql<number>`count(*)` }).from(s.auditLog).where(lt(s.auditLog.createdAt, cutoff));
  const [contributors] = await db
    .select({ n: sql<number>`count(*)` })
    .from(s.contributors)
    .where(sql`coalesce(${s.contributors.lastContributionAt}, ${s.contributors.lastInvitedAt}, ${s.contributors.createdAt}) < ${cutoff} and ${s.contributors.isActive} = false`);
  const [consents] = await db.select({ n: sql<number>`count(*)`, latestVersion: sql<string | null>`max(${s.consentRecords.textVersion})` }).from(s.consentRecords);
  const versions = await db.select({ version: s.consentRecords.textVersion, n: sql<number>`count(*)` }).from(s.consentRecords).groupBy(s.consentRecords.textVersion).orderBy(desc(s.consentRecords.textVersion));
  return {
    cutoff,
    staleEmails: Number(emails?.n ?? 0),
    staleAuditRows: Number(auditRows?.n ?? 0),
    dormantInactiveContributors: Number(contributors?.n ?? 0),
    consentRecords: Number(consents?.n ?? 0),
    consentVersions: versions.map((v) => ({ version: v.version, count: Number(v.n) })),
  };
}
