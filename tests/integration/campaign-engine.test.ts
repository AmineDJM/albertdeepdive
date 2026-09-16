import { promises as fs } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db/client";
import { automationRuns, consentRecords, contributors, editions, emailLog, jobs, mediaAssets, notifications, submissionAttachments, submissionRequests, submissions } from "@/server/db/schema";
import { ensureSeeded } from "../helpers/db";
import {
  addContributorsToCampaign,
  campaignStats,
  closeCampaign,
  createOrUpdateCampaign,
  getCampaignForEdition,
  openCampaign,
  previewSelection,
  reopenCampaign,
  resendInvitation,
  sendReminders,
  type Campaign,
} from "@/server/campaigns/service";
import { coverageByCampus } from "@/server/campaigns/coverage";
import { declineInvitation, getOrCreateDraft, resolveInvitation, saveDraft, startAnotherDraft, submitDraft, toInvitationDTO } from "@/server/submissions/public";
import { attachUpload, listUploads, removeUpload, updateUploadMeta } from "@/server/submissions/uploads";
import { AppError, ValidationError } from "@/lib/action-result";
import { JOB_TYPES } from "@/server/jobs/registry";
import { CONSENT_TEXT_VERSION } from "@/lib/constants";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// A Windows executable header: sniffed as application/x-msdownload, never accepted.
const EXE_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

function tokenFromLink(link: string) {
  return new URL(link).pathname.split("/").pop()!;
}

async function countEmails(template: string, editionId: string) {
  const rows = await db.select({ id: emailLog.id }).from(emailLog).where(and(eq(emailLog.template, template), eq(emailLog.editionId, editionId)));
  return rows.length;
}

describe("campaign engine", () => {
  let editionId: string;
  let campaign: Campaign;
  let links: { contributorId: string; requestId: string; link: string }[] = [];
  let submitterToken: string;
  let declinerToken: string;
  let draftId: string;

  beforeAll(async () => {
    const seed = await ensureSeeded();
    editionId = seed.nextEditionId;
  });

  it("rejects a campaign whose dates are out of order", async () => {
    const now = Date.now();
    await expect(
      createOrUpdateCampaign(
        editionId,
        { opensAt: new Date(now), reminder1At: new Date(now - DAY), reminder2At: new Date(now + 2 * DAY), deadlineAt: new Date(now + 3 * DAY), graceEndsAt: new Date(now + 4 * DAY), targets: {}, contributorGroupIds: [] },
        null,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { reminder1At: ["Reminder 1 must come after the opening"] } });
  });

  it("updates the seeded campaign with dates around now and a school-wide target", async () => {
    const existing = await getCampaignForEdition(editionId);
    expect(existing?.status).toBe("SCHEDULED");
    const now = Date.now();
    campaign = await createOrUpdateCampaign(
      editionId,
      {
        opensAt: new Date(now - HOUR),
        reminder1At: new Date(now + DAY),
        reminder2At: new Date(now + 2 * DAY),
        deadlineAt: new Date(now + 3 * DAY),
        graceEndsAt: new Date(now + 4 * DAY),
        targets: { ...(existing!.targets ?? {}), school: 5 },
        contributorGroupIds: existing!.contributorGroupIds,
        introMessage: "Tell us about your first Business Deep Dives.",
        autoProcess: true,
      },
      null,
    );
    expect(campaign.id).toBe(existing!.id);
    expect(campaign.status).toBe("SCHEDULED");
    expect(campaign.targets?.school).toBe(5);
  });

  it("previews the selection with per-campus shortfalls", async () => {
    const preview = await previewSelection(campaign.id);
    expect(preview.totals.selected).toBe(18);
    expect(preview.totals.alreadyInvited).toBe(0);
    const geneva = preview.byCampus.find((c) => c.name === "Geneva");
    expect(geneva?.shortfall).toBe(5);
    const school = preview.byCampus.find((c) => c.key === "school");
    expect(school?.selected).toBe(2);
  });

  it("opens the campaign: requests, invitation emails, edition OPEN — idempotently", async () => {
    const result = await openCampaign(campaign.id, { triggeredBy: "MANUAL", collectLinks: true });
    expect(result.skipped).toBe(false);
    expect(result.invited).toBe(18);
    expect(result.emailsSent).toBe(18);
    expect(result.shortfall).toMatchObject({ school: 3 });
    links = result.links ?? [];
    expect(links).toHaveLength(18);
    expect(links[0].link).toMatch(/\/contribute\/[A-Za-z0-9_-]{40,}$/);

    const requests = await db.select().from(submissionRequests).where(eq(submissionRequests.campaignId, campaign.id));
    expect(requests).toHaveLength(18);
    expect(requests.every((r) => r.status === "SENT" && r.sentAt)).toBe(true);
    expect(await countEmails("campaign_invitation", editionId)).toBe(18);

    const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
    expect(edition?.status).toBe("OPEN");
    const reloaded = await getCampaignForEdition(editionId);
    expect(reloaded?.status).toBe("OPEN");
    const run = await db.query.automationRuns.findFirst({ where: eq(automationRuns.runKey, `${editionId}:CAMPAIGN_OPEN`) });
    expect(run?.status).toBe("SUCCEEDED");
    expect(run?.triggeredBy).toBe("MANUAL");
    const editorNotes = await db.select().from(notifications).where(eq(notifications.type, "CONTRIBUTION_REQUEST"));
    expect(editorNotes.length).toBeGreaterThan(0);

    const again = await openCampaign(campaign.id, { triggeredBy: "SCHEDULER" });
    expect(again.skipped).toBe(true);
    expect(await countEmails("campaign_invitation", editionId)).toBe(18);
    const invitedContributor = await db.query.contributors.findFirst({ where: eq(contributors.id, links[0].contributorId) });
    expect(invitedContributor?.invitationsCount).toBe(2); // 1 from the seed + this campaign
  });

  it("resolves a personal link, marks it opened and exposes a draft-free DTO", async () => {
    submitterToken = tokenFromLink(links[0].link);
    declinerToken = tokenFromLink(links[1].link);
    expect(await resolveInvitation("not-a-token")).toBeNull();
    expect(await resolveInvitation("A".repeat(43))).toBeNull();

    const resolved = await resolveInvitation(submitterToken, { markOpened: true });
    expect(resolved).not.toBeNull();
    expect(resolved!.request.status).toBe("OPENED");
    expect(resolved!.request.openedAt).toBeInstanceOf(Date);
    expect(resolved!.canSubmit).toBe(true);
    expect(resolved!.phase).toBe("OPEN");
    expect(resolved!.contributor.id).toBe(links[0].contributorId);

    const dto = await toInvitationDTO(resolved!);
    expect(dto.draft).toBeNull();
    expect(dto.campuses.length).toBe(4);
    expect(dto.consentTextVersion).toBe(CONSENT_TEXT_VERSION);
    expect(dto.contactEmail).toBe("albertsdeepdive@albertschool.com");
    expect(JSON.stringify(dto)).not.toContain("tokenHash");
  });

  it("creates a prefilled draft and restores it after autosave", async () => {
    const resolved = (await resolveInvitation(submitterToken))!;
    const draft = await getOrCreateDraft(resolved.request.id);
    draftId = draft.id;
    expect(draft.contactEmail).toBe(resolved.contributor.email);
    expect(draft.contactName).toContain(resolved.contributor.firstName);
    expect(draft.campusIds).toEqual(resolved.contributor.campusId ? [resolved.contributor.campusId] : []);
    expect((await getOrCreateDraft(resolved.request.id)).id).toBe(draftId); // same draft, not a new one

    const saved = await saveDraft(draftId, submitterToken, { storyType: "BUSINESS_DEEP_DIVE", title: "Carrefour – B2 Paris", description: "Work in progress", extra: { company: "Carrefour" }, campusIds: [] });
    expect(saved.draftId).toBe(draftId);
    const restored = (await toInvitationDTO(resolved)).draft;
    expect(restored?.id).toBe(draftId);
    expect(restored?.title).toBe("Carrefour – B2 Paris");
    expect(restored?.storyType).toBe("BUSINESS_DEEP_DIVE");
    expect(restored?.extra).toEqual({ company: "Carrefour" });
    expect(restored?.campusIds).toEqual([]);

    await expect(saveDraft(draftId, declinerToken, { title: "hijack" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveDraft(draftId, submitterToken, { campusIds: "paris" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("attaches a seed photo, a document, refuses unknown types and removes uploads", async () => {
    const buffer = await fs.readFile(path.join(process.cwd(), "seed", "media", "kaern-team.jpg"));
    const { attachment } = await attachUpload(draftId, submitterToken, { buffer, fileName: "kaern-team.jpg", mimeType: "image/jpeg", caption: "The KÆRN team", photographer: "Simon Flasaquier" });
    expect(attachment.kind).toBe("IMAGE");
    expect(attachment.thumbnailUrl).toMatch(/\/api\/storage\/media\/.*thumbnail\.webp\?exp=\d+&sig=/);
    expect(attachment.width).toBeGreaterThan(0);
    const asset = await db.query.mediaAssets.findFirst({ where: eq(mediaAssets.submissionId, draftId) });
    expect(asset?.rightsStatus).toBe("YELLOW");
    expect(asset?.credit).toBe("© Simon Flasaquier");

    const updated = await updateUploadMeta(draftId, submitterToken, attachment.id, { caption: "KÆRN founders", photographer: "Simon F." });
    expect(updated.attachment.caption).toBe("KÆRN founders");

    const pdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
    const doc = await attachUpload(draftId, submitterToken, { buffer: pdf, fileName: "pitch deck.pdf", mimeType: "application/pdf" });
    expect(doc.attachment.kind).toBe("DOCUMENT");
    expect(doc.attachment.thumbnailUrl).toBeNull();
    const csv = await attachUpload(draftId, submitterToken, { buffer: Buffer.from("team,campus\nA,Paris\n"), fileName: "teams.csv", mimeType: "text/csv" });
    expect(csv.attachment.mimeType).toBe("text/csv");

    await expect(attachUpload(draftId, submitterToken, { buffer: EXE_HEADER, fileName: "virus.exe", mimeType: "application/octet-stream" })).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE", status: 415 });
    await expect(attachUpload(draftId, submitterToken, { buffer: Buffer.alloc(0), fileName: "empty.txt", mimeType: "text/plain" })).rejects.toBeInstanceOf(ValidationError);
    await expect(attachUpload(draftId, declinerToken, { buffer: pdf, fileName: "x.pdf", mimeType: "application/pdf" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await listUploads(draftId, submitterToken)).toHaveLength(3);
    await removeUpload(draftId, submitterToken, csv.attachment.id);
    expect(await listUploads(draftId, submitterToken)).toHaveLength(2);
    const rows = await db.select().from(submissionAttachments).where(eq(submissionAttachments.submissionId, draftId));
    expect(rows.map((r) => r.kind).sort()).toEqual(["DOCUMENT", "IMAGE"]);
  });

  it("submits the draft: NEW status, consent records, request + contributor stats, processing job", async () => {
    const payload = {
      storyType: "BUSINESS_DEEP_DIVE",
      title: "Carrefour – B2 Paris",
      campusIds: [] as string[],
      description: "Three weeks on Carrefour's promotion data: forecasting the uplift of in-store promotions with LightGBM and a Streamlit dashboard for category managers.",
      peopleInvolved: "Anna Spira, Sacha Nardoux",
      whyItMatters: "It is the first BDD of the year.",
      urls: ["albertschool.com"],
      contactEmail: "",
      publicationConsent: true,
      imageRightsConfirmed: false,
      extra: { company: "Carrefour", winningTeam: "Anna Spira\nSacha Nardoux", technologies: "LightGBM, Streamlit" },
    };
    const missingRights = await submitDraft(draftId, submitterToken, payload, { ip: "10.0.0.1", userAgent: "vitest" }).catch((err) => err);
    expect(missingRights).toBeInstanceOf(ValidationError);
    expect((missingRights as ValidationError).fieldErrors?.imageRightsConfirmed).toBeDefined();
    const missingCompany = await submitDraft(draftId, submitterToken, { ...payload, imageRightsConfirmed: true, extra: {} }, {}).catch((err) => err);
    expect((missingCompany as ValidationError).fieldErrors).toMatchObject({ "extra.company": ["Company is required"], "extra.winningTeam": ["Winning team is required"] });

    const { submissionId } = await submitDraft(draftId, submitterToken, { ...payload, imageRightsConfirmed: true }, { ip: "10.0.0.1", userAgent: "vitest" });
    expect(submissionId).toBe(draftId);
    const row = await db.query.submissions.findFirst({ where: eq(submissions.id, draftId) });
    expect(row?.status).toBe("NEW");
    expect(row?.submittedAt).toBeInstanceOf(Date);
    expect(row?.campusScope).toBe("SCHOOL_WIDE");
    expect(row?.urls).toEqual(["https://albertschool.com"]);
    expect(row?.wordCount).toBeGreaterThan(20);
    expect(row?.consentTextVersion).toBe(CONSENT_TEXT_VERSION);
    expect(row?.contactEmail).toBeTruthy();
    expect(row?.extra).toMatchObject({ company: "Carrefour" });

    const consents = await db.select().from(consentRecords).where(eq(consentRecords.submissionId, draftId));
    expect(consents.map((c) => c.type).sort()).toEqual(["IMAGE_RIGHTS", "IMAGE_RIGHTS", "PUBLICATION"]);
    expect(consents.every((c) => c.ipHash && c.userAgent === "vitest")).toBe(true);

    const request = await db.query.submissionRequests.findFirst({ where: eq(submissionRequests.tokenHash, (await resolveInvitation(submitterToken))!.tokenHash) });
    expect(request?.status).toBe("SUBMITTED");
    expect(request?.submissionsCount).toBe(1);
    const contributor = await db.query.contributors.findFirst({ where: eq(contributors.id, links[0].contributorId) });
    expect(contributor?.lastContributionAt).toBeInstanceOf(Date);
    expect(contributor?.responseRate).toBeGreaterThan(0);

    const job = await db.query.jobs.findFirst({ where: eq(jobs.idempotencyKey, `submission-process:${draftId}`) });
    expect(job?.type).toBe(JOB_TYPES.SUBMISSION_PROCESS);
    expect(job?.status).toBe("QUEUED");

    await expect(saveDraft(draftId, submitterToken, { title: "too late" })).rejects.toMatchObject({ code: "ALREADY_SUBMITTED" });
    const another = await startAnotherDraft(request!.id);
    expect(another.id).not.toBe(draftId);
    expect(another.title).toBe("");
  });

  it("declines and un-declines an invitation", async () => {
    const declined = await declineInvitation(declinerToken, { reason: "On exchange this semester" }, { ip: "10.0.0.2" });
    expect(declined.status).toBe("DECLINED");
    const resolved = await resolveInvitation(declinerToken);
    expect(resolved?.canSubmit).toBe(false);
    expect(resolved?.blockedReason).toBe("DECLINED");
    expect((await declineInvitation(declinerToken, { undo: true })).status).toBe("OPENED");
    await expect(declineInvitation(submitterToken)).rejects.toMatchObject({ code: "ALREADY_SUBMITTED" });
  });

  it("computes campaign statistics", async () => {
    const stats = await campaignStats(campaign.id);
    expect(stats.invited).toBe(18);
    expect(stats.submitted).toBe(1);
    expect(stats.submissions).toBe(1);
    expect(stats.opened).toBeGreaterThanOrEqual(2);
    expect(stats.responseRate).toBeCloseTo(1 / 18, 3);
    expect(stats.byCampus.find((c) => c.name === "Whole school")?.submissions).toBe(1);
    expect(stats.timeline).toHaveLength(1);
    expect(stats.timeline[0].submissions).toBe(1);
  });

  it("sends reminders once and to the right people", async () => {
    const first = await sendReminders(campaign.id, "REMINDER_1", { triggeredBy: "SCHEDULER" });
    expect(first.skipped).toBe(false);
    expect(first.targeted).toBe(17); // 18 invited − 1 who submitted (the decliner was un-declined)
    expect(first.emailsSent).toBe(17);
    expect(await countEmails("campaign_reminder_1", editionId)).toBe(17);
    const second = await sendReminders(campaign.id, "REMINDER_1", { triggeredBy: "SCHEDULER" });
    expect(second.skipped).toBe(true);
    expect(await countEmails("campaign_reminder_1", editionId)).toBe(17);
    expect((await getCampaignForEdition(editionId))?.status).toBe("REMINDER_1");
    expect((await db.query.editions.findFirst({ where: eq(editions.id, editionId) }))?.status).toBe("REMINDER_1");
    const reminded = await db.query.submissionRequests.findFirst({ where: eq(submissionRequests.tokenHash, (await resolveInvitation(declinerToken))!.tokenHash) });
    expect(reminded?.remindedCount).toBe(1);
    // The reminder carries the same personal link.
    const reminderMail = await db.query.emailLog.findFirst({ where: and(eq(emailLog.template, "campaign_reminder_1"), eq(emailLog.contributorId, links[1].contributorId)) });
    expect(reminderMail?.html).toContain(links[1].link);
  });

  it("resends an invitation with a rotated link and adds contributors on the fly", async () => {
    const resolved = (await resolveInvitation(declinerToken))!;
    const before = await countEmails("campaign_invitation", editionId);
    const result = await resendInvitation(resolved.request.id, null);
    expect(result.ok).toBe(true);
    expect(await countEmails("campaign_invitation", editionId)).toBe(before + 1);
    expect(await resolveInvitation(declinerToken)).toBeNull(); // old link rotated away

    const eugenia = await db.query.contributors.findFirst({ where: eq(contributors.email, "eugenia.school-team@example.com") });
    expect(eugenia).toBeTruthy();
    const added = await addContributorsToCampaign(campaign.id, [eugenia!.id], null);
    expect(added).toEqual({ added: 1, sent: 1 });
    expect((await addContributorsToCampaign(campaign.id, [eugenia!.id], null)).added).toBe(0);
    expect((await campaignStats(campaign.id)).invited).toBe(19);
  });

  it("closes the campaign: edition CLOSED, thank-you emails, processing job queued — idempotently", async () => {
    const result = await closeCampaign(campaign.id, { triggeredBy: "MANUAL" });
    expect(result.skipped).toBe(false);
    expect(result.submissions).toBe(1);
    expect(result.contributors).toBe(1);
    expect(result.thankYouEmails).toBe(1);
    expect(result.processingQueued).toBe(true);
    expect(await countEmails("campaign_closed", editionId)).toBe(1);
    expect((await db.query.editions.findFirst({ where: eq(editions.id, editionId) }))?.status).toBe("CLOSED");
    const closed = await getCampaignForEdition(editionId);
    expect(closed?.status).toBe("CLOSED");
    expect(closed?.closedAt).toBeInstanceOf(Date);
    const job = await db.query.jobs.findFirst({ where: eq(jobs.idempotencyKey, `edition-process:${editionId}`) });
    expect(job?.type).toBe(JOB_TYPES.EDITION_PROCESS);
    expect(job?.payload).toEqual({ editionId });

    const again = await closeCampaign(campaign.id, { triggeredBy: "SCHEDULER" });
    expect(again.skipped).toBe(true);
    expect(await countEmails("campaign_closed", editionId)).toBe(1);

    const resolved = await resolveInvitation(submitterToken);
    expect(resolved?.canSubmit).toBe(false);
    expect(resolved?.blockedReason).toBe("CLOSED");
    await expect(sendReminders(campaign.id, "REMINDER_2", { triggeredBy: "SCHEDULER" })).resolves.toMatchObject({ skipped: true });
  });

  it("reopens a closed campaign and can close it again", async () => {
    const reopened = await reopenCampaign(campaign.id, { graceEndsAt: new Date(Date.now() + 2 * DAY) });
    expect(reopened.status).toBe("GRACE_PERIOD");
    expect(reopened.closedAt).toBeNull();
    expect((await db.query.editions.findFirst({ where: eq(editions.id, editionId) }))?.status).toBe("GRACE_PERIOD");
    expect((await resolveInvitation(submitterToken))?.canSubmit).toBe(true);
    const closed = await closeCampaign(campaign.id, { triggeredBy: "MANUAL" });
    expect(closed.skipped).toBe(false);
    expect((await db.query.editions.findFirst({ where: eq(editions.id, editionId) }))?.status).toBe("CLOSED");
    await expect(reopenCampaign(campaign.id, { graceEndsAt: new Date(Date.now() - DAY) })).rejects.toBeInstanceOf(AppError);
  });

  it("measures campus coverage of the seeded edition", async () => {
    const seed = await ensureSeeded();
    const coverage = await coverageByCampus(seed.editionId);
    expect(coverage.campuses.map((c) => c.slug)).toEqual(["paris", "lyon", "marseille", "geneva"]);
    expect(coverage.totals.submissions).toBeGreaterThan(10);
    expect(coverage.campuses.find((c) => c.slug === "paris")!.submissions).toBeGreaterThan(coverage.campuses.find((c) => c.slug === "geneva")!.submissions);
    expect(coverage.campuses.reduce((n, c) => n + c.storiesSelected, 0)).toBeGreaterThan(0);
    expect(coverage.balance.underrepresented.length).toBeGreaterThan(0);
    expect(["Uneven", "Critical"]).toContain(coverage.balance.label);
    expect(coverage.balance.score).toBeGreaterThanOrEqual(0);
    expect(coverage.balance.score).toBeLessThanOrEqual(1);
    const shares = coverage.campuses.reduce((n, c) => n + c.share, 0);
    expect(Math.abs(shares - 1)).toBeLessThan(0.01);
  });
});
