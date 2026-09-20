import "@/server/load-env";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getTableName, sql } from "drizzle-orm";
import { db, schema } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { env } from "@/server/env";
import { hashPassword } from "@/server/auth/password";
import { DEFAULT_BRAND_SYSTEM } from "@/lib/brand/system";
import { generateOpaqueToken } from "@/server/auth/tokens";
import { contributionLink, mintRequestToken, requestTokenHash } from "@/server/campaigns/tokens";
import { ingestMedia } from "@/server/media/ingest";
import { PROMPT_DEFAULTS } from "@/server/ai/prompts";
import { estimateCostCents } from "@/server/ai/pricing";
import { DEFAULT_SECTIONS, PAGE_TEMPLATES, CONSENT_TEXT_VERSION, templateByCode } from "@/lib/constants";
import { countWords } from "@/lib/publication/document";
import { slugify } from "@/lib/utils";
import { SEED_STORIES, SEED_CAMPUSES, SEED_PROGRAMS, SEED_COVER, SEED_FLATPLAN, SEED_CREDITS, SEED_CONTRIBUTORS, SEED_GROUPS } from "../../../seed";

const SEED_MEDIA_DIR = path.join(process.cwd(), "seed", "media");

function contributorEmail(c: { firstName: string; lastName: string }) {
  return `${slugify(c.firstName)}.${slugify(c.lastName)}@example.com`;
}

function normalizeName(name: string) {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function at(base: Date, days: number, hours = 0, minutes = 0) {
  return new Date(base.getTime() + ((days * 24 + hours) * 60 + minutes) * 60_000);
}
import { seedShowcase } from "./seed-showcase";

async function truncateAll(quiet = false) {
  const names = Object.values(schema)
    .filter((v): v is (typeof s)["users"] => !!v && typeof v === "object" && Symbol.for("drizzle:Name") in (v as object))
    .map((t) => getTableName(t));
  const unique = [...new Set(names)];
  await db.execute(sql.raw(`TRUNCATE TABLE ${unique.map((n) => `"${n}"`).join(", ")} RESTART IDENTITY CASCADE`));
  if (!quiet) console.log(`[seed] truncated ${unique.length} tables`);
}

export type SeedResult = { editionId: string; nextEditionId: string; adminEmail: string; password: string };

export async function runSeed(options: { quiet?: boolean } = {}): Promise<SeedResult> {
  const say = (...args: unknown[]) => (options.quiet ? undefined : console.log(...args));
  if (env.NODE_ENV === "production" && process.env.FORCE_SEED !== "1") {
    throw new Error("Refusing to seed a production database without FORCE_SEED=1");
  }
  say(`[seed] database: ${env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}`);
  await truncateAll(options.quiet);

  // ── Workspace ──────────────────────────────────────────────────────────────
  // Briefly is multi-tenant: Albert School is one customer among many, not the platform.
  const [org] = await db
    .insert(s.organizations)
    .values({
      name: "Albert School",
      slug: "albert-school",
      type: "SCHOOL",
      website: "https://albertschool.com",
      description: "The business school for the data and AI generation.",
      locale: "en",
      timezone: "Europe/Paris",
      country: "France",
      onboardedAt: new Date(),
    })
    .returning();
  const organizationId = org.id;

  // ── Campuses & programmes ──────────────────────────────────────────────────
  const campusRows = await db.insert(s.campuses).values(SEED_CAMPUSES.map((c) => ({ ...c, organizationId, isActive: true }))).returning();
  const campusBySlug = new Map(campusRows.map((c) => [c.slug, c]));
  const programRows = await db.insert(s.academicPrograms).values(SEED_PROGRAMS.map((p) => ({ ...p, organizationId }))).returning();
  const programByCode = new Map(programRows.map((p) => [p.code, p]));

  // ── Users ──────────────────────────────────────────────────────────────────
  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);

  /*
   * Two administrators, because running Briefly and running a newsroom are different jobs.
   *
   * The platform admin is Briefly's own: the console that reads across every customer — workspaces,
   * people, payments, integrations — and the right to open any workspace as support. It belongs to
   * no workspace. The workspace admin is the customer's: the owner of this newsroom, with everything
   * a customer can do and nothing a customer cannot. They were one account until now, which is why
   * "which one is the super admin" had no good answer. Point SEED_ADMIN_EMAIL at the workspace
   * address and they collapse back into one, for an installation that wants it that way.
   */
  const WORKSPACE_ADMIN_EMAIL = "admin@albertschool.com";
  const separatePlatformAdmin = env.SEED_ADMIN_EMAIL.toLowerCase() !== WORKSPACE_ADMIN_EMAIL;
  const userRows = await db
    .insert(s.users)
    .values([
      separatePlatformAdmin
        ? { email: WORKSPACE_ADMIN_EMAIL, name: "Albert School Admin", role: "EDITOR_IN_CHIEF" as const, passwordHash }
        : { email: env.SEED_ADMIN_EMAIL, name: "Newsroom Admin", role: "SUPER_ADMIN" as const, passwordHash },
      { email: "eic@albertschool.com", name: "Editor in Chief", role: "EDITOR_IN_CHIEF", passwordHash },
      { email: "editor@albertschool.com", name: "Desk Editor", role: "EDITOR", passwordHash },
      { email: "lyon@albertschool.com", name: "Campus Editor Lyon", role: "CAMPUS_EDITOR", passwordHash, campusId: campusBySlug.get("lyon")!.id },
      { email: "viewer@albertschool.com", name: "Management Viewer", role: "VIEWER", passwordHash },
    ])
    .returning();
  const admin = userRows[0];
  const eic = userRows[1];
  const editor = userRows[2];
  // Platform role and workspace role are different things: the first says what someone may do in
  // Briefly, the second what they may do inside this customer's newsroom. The first row owns it.
  const workspaceRole = { SUPER_ADMIN: "OWNER", EDITOR_IN_CHIEF: "ADMIN", EDITOR: "EDITOR", CAMPUS_EDITOR: "EDITOR", CONTRIBUTOR: "CONTRIBUTOR", VIEWER: "VIEWER" } as const;
  await db.insert(s.organizationMembers).values(
    userRows.map((u, index) => ({ organizationId, userId: u.id, role: index === 0 ? ("OWNER" as const) : workspaceRole[u.role], isDefault: true, acceptedAt: new Date() })),
  );
  if (separatePlatformAdmin) {
    await db.insert(s.users).values({ email: env.SEED_ADMIN_EMAIL, name: "Briefly Platform Admin", role: "SUPER_ADMIN", passwordHash });
  }
  await db.update(s.organizations).set({ createdById: admin.id }).where(sql`${s.organizations.id} = ${organizationId}`);

  // ── Brand ──────────────────────────────────────────────────────────────────
  // Albert's own navy and blue, as the design system every renderer reads from. Written explicitly
  // rather than left to the lazy default, so a fresh seed always looks like Albert School.
  await db.insert(s.brandSystems).values({
    organizationId,
    system: {
      ...DEFAULT_BRAND_SYSTEM,
      colours: { brand: "#10203A", accent: "#2BAFE0", ink: "#17191C", paper: "#FFFFFF" },
      personality: "editorial",
      voice: { tone: ["precise", "confident"], avoid: ["synergy", "disruptive"], person: "third" },
    },
    origin: { brand: "discovered", accent: "discovered" },
    createdById: admin.id,
  });

  // ── Billing ────────────────────────────────────────────────────────────────
  // The seed represents an established customer, so it gets the plan that covers what it does:
  // a printed magazine, a team of five, and an audience. A fresh signup starts on free instead.
  const { DEFAULT_PLANS } = await import("@/server/billing/plans");
  const planRows = await db
    .insert(s.plans)
    .values(
      DEFAULT_PLANS.map((p) => ({
        key: p.key,
        name: p.name,
        tagline: p.tagline,
        priceMonthlyCents: p.priceMonthlyCents,
        priceYearlyCents: p.priceYearlyCents,
        entitlements: p.entitlements,
        highlights: p.highlights,
        isDefault: p.isDefault ?? false,
        isFeatured: p.isFeatured ?? false,
        isCustomPriced: p.isCustomPriced ?? false,
        sortOrder: p.sortOrder,
      })),
    )
    .returning();
  const businessPlan = planRows.find((p) => p.key === "business") ?? planRows[0];
  await db.insert(s.organizationSubscriptions).values({ organizationId, planId: businessPlan.id, status: "ACTIVE" });

  // ── Publication ────────────────────────────────────────────────────────────
  // A recurring title. Its editions each choose their own outputs — email, web, magazine, print.
  const [publication] = await db
    .insert(s.publications)
    .values({
      organizationId,
      name: "Albert Deep Dive",
      slug: "deep-dive",
      description: "The monthly magazine of Albert School.",
      language: "en",
      defaultFormats: ["MAGAZINE", "EMAIL"],
      cadence: "monthly",
      subscribeSlug: "albert-deep-dive",
      joinSlug: "albert-deep-dive",
      createdById: admin.id,
    })
    .returning();

  // ── Contributors & groups ──────────────────────────────────────────────────
  const groupRows = await db
    .insert(s.contributorGroups)
    .values(SEED_GROUPS.map((g) => ({ organizationId, slug: g.slug, name: g.name, description: "description" in g ? g.description : null, campusId: "campus" in g && g.campus ? campusBySlug.get(g.campus)!.id : null, isSystem: true })))
    .returning();
  const groupBySlug = new Map(groupRows.map((g) => [g.slug, g]));
  const contributorRows = await db
    .insert(s.contributors)
    .values(
      SEED_CONTRIBUTORS.map((c) => ({
        organizationId,
        firstName: c.firstName,
        lastName: c.lastName,
        email: contributorEmail(c),
        campusId: c.campus ? campusBySlug.get(c.campus)!.id : null,
        programId: c.program ? programByCode.get(c.program)!.id : null,
        type: c.type,
        organisationName: c.organisationName ?? null,
        preferredLanguage: c.language ?? "en",
        tags: c.tags ?? [],
        isActive: true,
      })),
    )
    .returning();
  const contributorByKey = new Map(SEED_CONTRIBUTORS.map((c, i) => [c.key, contributorRows[i]]));
  await db.insert(s.contributorGroupMembers).values(
    SEED_CONTRIBUTORS.flatMap((c) => c.groups.map((g) => ({ groupId: groupBySlug.get(g)!.id, contributorId: contributorByKey.get(c.key)!.id }))),
  );

  // ── Prompt templates & settings ────────────────────────────────────────────
  await db.insert(s.promptTemplates).values(
    PROMPT_DEFAULTS.map((p) => ({ organizationId, key: p.key, version: 1, name: p.name, description: p.description, category: p.category, systemPrompt: p.system, userPrompt: p.user, modelTier: p.tier, temperature: p.temperature, maxOutputTokens: p.maxOutputTokens, isActive: true, createdById: admin.id })),
  );
  await db.insert(s.systemSettings).values([
    { key: "masthead", value: { title: "Albert's Deep Dive", tagline: "The monthly newspaper of Albert School" }, description: "Publication masthead" },
    { key: "contact", value: { email: "albertsdeepdive@albertschool.com", website: "www.albertschool.com", instagram: "albertsdeepdive" }, description: "Contact details printed in the colophon" },
    { key: "campaign_defaults", value: { openDay: 1, openHour: 9, reminder1Day: 4, reminder2Day: 7, graceDay: 8, publicationDay: 15, finalReviewDay: 11 }, description: "Default monthly schedule (day of month)" },
    { key: "default_sections", value: DEFAULT_SECTIONS, description: "Sections created for every new edition" },
    { key: "print", value: { pageSize: "A4", targetPageCount: 24, mastheadFont: "Fraunces" }, description: "Print defaults" },
    { key: "privacy", value: { retentionDays: 730, consentTextVersion: CONSENT_TEXT_VERSION }, description: "Data retention and consent" },
    { key: "ai", value: { monthlyBudgetEur: env.AI_MAX_MONTHLY_BUDGET_EUR, provider: env.AI_PROVIDER }, description: "AI budget and routing" },
    { key: "automations", value: { editionCreation: true, contributionRequest: true, reminder1: true, reminder2: true, gracePeriod: true, aiProcessing: true, editorialAlert: true, coverageCheck: true, deadlineAlert: true }, description: "Automation toggles" },
  ]);

  // ── Edition 1: Special issue N°1 — May 2025 ────────────────────────────────
  const opensAt = new Date("2025-04-01T07:00:00Z");
  const [edition] = await db
    .insert(s.editions)
    .values({
      organizationId,
      publicationId: publication.id,
      issueNumber: 1,
      title: "Albert's Deep Dive — Special issue N°1",
      slug: "special-issue-1-may-2025",
      label: "May 2025",
      month: 5,
      year: 2025,
      status: "EDITORIAL_REVIEW",
      isSpecialIssue: true,
      publicationTargetAt: new Date("2025-05-15T10:00:00Z"),
      finalReviewAt: new Date("2025-05-12T16:00:00Z"),
      pageSize: "A4",
      targetPageCount: 24,
      coverHeadline: SEED_COVER.headline,
      coverStandfirst: SEED_COVER.standfirst,
      editorial: "Three months of Business Deep Dives, a first regatta, a new association and a school that now trains executives too. This special issue is the first Albert's Deep Dive produced with the newsroom platform.",
      editorInChiefId: eic.id,
      createdById: admin.id,
      createdAt: new Date("2025-03-28T09:00:00Z"),
    })
    .returning();

  const sectionRows = await db
    .insert(s.editionSections)
    .values(DEFAULT_SECTIONS.map((sec, i) => ({ editionId: edition.id, slug: sec.slug, name: sec.name, kicker: sec.kicker, colour: sec.colour, sortOrder: i, targetPages: sec.targetPages })))
    .returning();
  const sectionBySlug = new Map(sectionRows.map((r) => [r.slug, r]));

  const [campaign] = await db
    .insert(s.submissionCampaigns)
    .values({
      editionId: edition.id,
      name: "May 2025 contributions",
      status: "CLOSED",
      opensAt,
      reminder1At: new Date("2025-04-04T07:00:00Z"),
      reminder2At: new Date("2025-04-07T07:00:00Z"),
      deadlineAt: new Date("2025-04-07T21:59:00Z"),
      graceEndsAt: new Date("2025-04-08T21:59:00Z"),
      closedAt: new Date("2025-04-08T22:00:00Z"),
      targets: { [campusBySlug.get("paris")!.id]: 12, [campusBySlug.get("lyon")!.id]: 6, [campusBySlug.get("marseille")!.id]: 6, [campusBySlug.get("geneva")!.id]: 2 },
      contributorGroupIds: groupRows.filter((g) => g.slug !== "partners").map((g) => g.id),
      introMessage: "Three months of Business Deep Dives, events and campus life: tell us what happened around you.",
      createdById: editor.id,
      createdAt: new Date("2025-03-28T09:30:00Z"),
    })
    .returning();

  // Requests: one per contributor.
  //
  // A contributor who has not filed yet keeps a *live* personal link, derived exactly as the
  // campaign engine derives it, so the demo can walk in through the public URL. Contributors who
  // already submitted keep an expired, undiscoverable token: their link has done its job.
  const contributorsWithSubmissions = new Set(SEED_STORIES.flatMap((st) => st.submissions.map((sub) => sub.contributor)));
  const openLinkExpiry = new Date(Date.now() + 30 * 86_400_000);
  const requestIds = new Map(SEED_CONTRIBUTORS.map((c) => [c.key, randomUUID()]));
  const requestRows = await db
    .insert(s.submissionRequests)
    .values(
      SEED_CONTRIBUTORS.map((c, i) => {
        const contributor = contributorByKey.get(c.key)!;
        const submitted = contributorsWithSubmissions.has(c.key);
        const id = requestIds.get(c.key)!;
        return {
          id,
          campaignId: campaign.id,
          editionId: edition.id,
          contributorId: contributor.id,
          campusId: contributor.campusId,
          tokenHash: submitted ? generateOpaqueToken().hash : requestTokenHash(id, openLinkExpiry),
          tokenExpiresAt: submitted ? new Date("2025-04-15T00:00:00Z") : openLinkExpiry,
          status: submitted ? ("SUBMITTED" as const) : i % 3 === 0 ? ("OPENED" as const) : ("SENT" as const),
          sentAt: at(opensAt, 0, 0, i),
          openedAt: submitted || i % 3 === 0 ? at(opensAt, 0, 3, i) : null,
          submittedAt: submitted ? at(opensAt, 2, 5, i) : null,
          remindedCount: submitted ? 0 : 2,
          lastRemindedAt: submitted ? null : new Date("2025-04-07T07:00:00Z"),
        };
      }),
    )
    .returning();
  const requestByContributorId = new Map(requestRows.map((r) => [r.contributorId, r]));

  // Email log: invitations + reminders (dev mailbox).
  // The invitation carries the contributor's real personal link, so the development mailbox shows
  // exactly what they received — and a live link can be opened straight from it.
  const invitationLink = (key: string) => {
    if (contributorsWithSubmissions.has(key)) return null;
    return contributionLink(mintRequestToken(requestIds.get(key)!, openLinkExpiry));
  };
  const invitationHtml = (key: string) => {
    const link = invitationLink(key);
    return link
      ? `<p>Tell us what happened around you this month.</p><p><a href="${link}">Open my personal link</a></p>`
      : "<p>Tell us what happened around you this month.</p><p>This personal link has expired.</p>";
  };
  await db.insert(s.emailLog).values(
    SEED_CONTRIBUTORS.flatMap((c, i) => {
      const contributor = contributorByKey.get(c.key)!;
      const rows: (typeof s.emailLog.$inferInsert)[] = [
        { to: contributor.email, subject: "Albert's Deep Dive — May 2025: tell us what happened around you", html: invitationHtml(c.key), textBody: `Your personal link: ${invitationLink(c.key) ?? "(expired)"}`, template: "campaign_invitation", status: "LOGGED", provider: "log", entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, contributorId: contributor.id, sentAt: at(opensAt, 0, 0, i), createdAt: at(opensAt, 0, 0, i) },
      ];
      if (!contributorsWithSubmissions.has(c.key)) {
        rows.push({ to: contributor.email, subject: "Reminder: 3 days left to contribute to Albert's Deep Dive", html: "<p>Reminder (seeded)</p>", textBody: "Reminder", template: "campaign_reminder", status: "LOGGED", provider: "log", entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, contributorId: contributor.id, sentAt: new Date("2025-04-04T07:00:00Z"), createdAt: new Date("2025-04-04T07:00:00Z") });
        rows.push({ to: contributor.email, subject: "Last day to contribute to Albert's Deep Dive", html: "<p>Reminder (seeded)</p>", textBody: "Reminder", template: "campaign_reminder", status: "LOGGED", provider: "log", entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, contributorId: contributor.id, sentAt: new Date("2025-04-07T07:00:00Z"), createdAt: new Date("2025-04-07T07:00:00Z") });
      }
      return rows;
    }),
  );

  // ── Media ingestion (shared by stories and cover) ──────────────────────────
  const mediaByFile = new Map<string, typeof s.mediaAssets.$inferSelect>();
  async function ingestFile(file: string, opts: { caption?: string; credit?: string; photographer?: string; kind?: "photo" | "logo" | "screenshot" | "diagram" | "chart" | "document"; rights?: "GREEN" | "YELLOW" | "RED"; submissionId?: string | null; contributorId?: string | null }) {
    if (mediaByFile.has(file)) return mediaByFile.get(file)!;
    const buffer = await fs.readFile(path.join(SEED_MEDIA_DIR, file));
    const { asset } = await ingestMedia({
      buffer,
      fileName: file,
      editionId: edition.id,
      submissionId: opts.submissionId ?? null,
      contributorId: opts.contributorId ?? null,
      caption: opts.caption ?? null,
      credit: opts.credit ?? null,
      photographer: opts.photographer ?? null,
      kind: opts.kind,
      rightsStatus: opts.rights ?? "YELLOW",
      rightsNote: opts.rights === "GREEN" ? "Published in the May 2025 issue; contributor confirmed image rights." : opts.rights === "RED" ? "Do not publish." : "Rights to confirm with the contributor.",
      skipDuplicateCheck: true,
    });
    mediaByFile.set(file, asset);
    return asset;
  }

  // ── Stories, submissions, clusters, articles ───────────────────────────────
  const peopleByName = new Map<string, typeof s.people.$inferSelect>();
  const orgByName = new Map<string, typeof s.organisations.$inferSelect>();
  const storyByKey = new Map<string, typeof s.stories.$inferSelect>();
  const articleByStoryKey = new Map<string, typeof s.articles.$inferSelect>();
  const submissionsByStoryKey = new Map<string, (typeof s.submissions.$inferSelect)[]>();
  const aiJobRows: (typeof s.aiJobs.$inferInsert)[] = [];
  let storyIndex = 0;

  for (const story of SEED_STORIES) {
    storyIndex += 1;
    const campusIds = story.campuses.map((c) => campusBySlug.get(c)!.id);
    const section = sectionBySlug.get(story.section)!;

    // Submissions
    const subRows: (typeof s.submissions.$inferSelect)[] = [];
    for (const [subIndex, sub] of story.submissions.entries()) {
      const contributor = contributorByKey.get(sub.contributor)!;
      const request = requestByContributorId.get(contributor.id);
      const created = at(opensAt, sub.daysAfterOpen ?? 2, 4 + subIndex, storyIndex * 3);
      const text = [sub.title, sub.description, sub.peopleInvolved, sub.organisationsInvolved, sub.whyItMatters, sub.quotes].filter(Boolean).join("\n");
      const [row] = await db
        .insert(s.submissions)
        .values({
          editionId: edition.id,
          campaignId: campaign.id,
          requestId: request?.id ?? null,
          contributorId: contributor.id,
          storyType: sub.storyType as typeof s.submissions.$inferInsert.storyType,
          title: sub.title,
          campusScope: sub.campuses.length === 0 ? "SCHOOL_WIDE" : sub.campuses.length > 1 ? "MULTI" : "SINGLE",
          eventDateText: sub.eventDateText ?? story.eventDateText ?? null,
          description: sub.description,
          peopleInvolved: sub.peopleInvolved ?? null,
          organisationsInvolved: sub.organisationsInvolved ?? null,
          whyItMatters: sub.whyItMatters ?? null,
          quotes: sub.quotes ?? null,
          urls: sub.urls ?? [],
          contactName: `${contributor.firstName} ${contributor.lastName}`,
          contactEmail: contributor.email,
          extra: sub.extra ?? {},
          language: contributor.preferredLanguage,
          status: sub.status ?? "ACCEPTED",
          source: "form",
          publicationConsent: true,
          imageRightsConfirmed: true,
          consentTextVersion: CONSENT_TEXT_VERSION,
          wordCount: text.split(/\s+/).length,
          normalizedText: text,
          aiSummary: story.standfirst ?? null,
          aiClassification: { storyType: story.storyType, sectionSlug: story.section, confidence: 0.86, tags: [story.section, story.storyType.toLowerCase()], language: contributor.preferredLanguage, summary: story.standfirst },
          aiEntities: {
            people: (story.people ?? []).map((pp) => ({ name: pp.name, role: pp.role })),
            organisations: (story.organisations ?? []).map((o) => ({ name: o.name, type: o.type })),
            dates: story.eventDateText ? [{ text: story.eventDateText }] : [],
          },
          aiWarnings: sub.status === "DUPLICATE" ? [{ code: "DUPLICATE", message: "Covers the same event as another submission in this cluster.", severity: "info" }] : [],
          aiImportance: story.aiScores ? Math.round(Object.values(story.aiScores).reduce((a, b) => a + b, 0) / Object.values(story.aiScores).length) / 100 : null,
          suggestedSectionSlug: story.section,
          processedAt: new Date("2025-04-09T08:00:00Z"),
          reviewedById: sub.status && sub.status !== "NEW" ? editor.id : null,
          reviewedAt: sub.status && sub.status !== "NEW" ? new Date("2025-04-10T09:00:00Z") : null,
          submittedAt: created,
          createdAt: created,
          updatedAt: created,
        })
        .returning();
      subRows.push(row);
      if (sub.campuses.length) {
        await db.insert(s.submissionCampuses).values(sub.campuses.map((c) => ({ submissionId: row.id, campusId: campusBySlug.get(c)!.id })));
      }
      await db.insert(s.consentRecords).values([
        { submissionId: row.id, contributorId: contributor.id, type: "PUBLICATION", textVersion: CONSENT_TEXT_VERSION, acceptedAt: created },
        { submissionId: row.id, contributorId: contributor.id, type: "IMAGE_RIGHTS", textVersion: CONSENT_TEXT_VERSION, acceptedAt: created },
      ]);
      // Attachments: ingest media declared on the submission
      for (const [mi, file] of (sub.media ?? []).entries()) {
        const spec = story.media.find((m) => m.file === file);
        const asset = await ingestFile(file, { caption: spec?.caption, credit: spec?.credit, photographer: spec?.photographer, kind: spec?.kind, rights: spec?.rights, submissionId: row.id, contributorId: contributor.id });
        await db.insert(s.submissionAttachments).values({ submissionId: row.id, mediaAssetId: asset.id, kind: "IMAGE", fileName: file, mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, storageKey: asset.storageKey, caption: spec?.caption ?? null, photographer: spec?.photographer ?? null, sortOrder: mi });
      }
      // AI job trace per submission (classification + entities)
      const inTok = 700 + row.wordCount * 2;
      aiJobRows.push(
        { service: "classifier", provider: "openai", model: "gpt-4.1-mini", promptKey: "classifier", promptVersion: 1, editionId: edition.id, entityType: "SUBMISSION", entityId: row.id, status: "SUCCEEDED", inputRefs: { submissionId: row.id }, inputHash: `seed-cls-${row.id.slice(0, 8)}`, output: row.aiClassification, confidence: 0.86, latencyMs: 900 + (storyIndex % 5) * 120, inputTokens: inTok, outputTokens: 90, costCents: String(estimateCostCents("gpt-4.1-mini", inTok, 90)), attempts: 1, createdAt: new Date("2025-04-09T08:05:00Z"), completedAt: new Date("2025-04-09T08:05:02Z") },
        { service: "entity_extractor", provider: "openai", model: "gpt-4.1-mini", promptKey: "entity_extractor", promptVersion: 1, editionId: edition.id, entityType: "SUBMISSION", entityId: row.id, status: "SUCCEEDED", inputRefs: { submissionId: row.id }, inputHash: `seed-ent-${row.id.slice(0, 8)}`, output: row.aiEntities, confidence: 0.8, latencyMs: 1200, inputTokens: inTok, outputTokens: 220, costCents: String(estimateCostCents("gpt-4.1-mini", inTok, 220)), attempts: 1, createdAt: new Date("2025-04-09T08:06:00Z"), completedAt: new Date("2025-04-09T08:06:02Z") },
      );
    }
    submissionsByStoryKey.set(story.key, subRows);

    // Story media (ensure every declared media is ingested, even if not attached to a submission)
    const storyAssets: { asset: typeof s.mediaAssets.$inferSelect; role: string }[] = [];
    for (const m of story.media) {
      const asset = await ingestFile(m.file, { caption: m.caption, credit: m.credit, photographer: m.photographer, kind: m.kind, rights: m.rights, submissionId: subRows[0]?.id ?? null, contributorId: subRows[0]?.contributorId ?? null });
      storyAssets.push({ asset, role: m.role ?? "gallery" });
    }

    // Cluster
    const [cluster] = await db
      .insert(s.storyClusters)
      .values({
        editionId: edition.id,
        title: story.title,
        summary: story.standfirst ?? null,
        status: story.status === "CANDIDATE" ? "PROPOSED" : "CONFIRMED",
        primaryStoryType: story.storyType as typeof s.storyClusters.$inferInsert.primaryStoryType,
        suggestedSectionSlug: story.section,
        submissionCount: subRows.length,
        mediaCount: storyAssets.length,
        quoteCount: story.quotes?.length ?? 0,
        factSheet: story.facts.map((f) => ({ statement: f.statement, sourceSubmissionIds: f.sourceIndex !== undefined && subRows[f.sourceIndex] ? [subRows[f.sourceIndex].id] : [], confidence: f.confidence, excerpt: f.excerpt })),
        aiScores: story.aiScores ? { ...story.aiScores, total: Math.round(Object.values(story.aiScores).reduce((a, b) => a + b, 0) / Object.values(story.aiScores).length) } : {},
        aiScoreTotal: story.aiScores ? Math.round(Object.values(story.aiScores).reduce((a, b) => a + b, 0) / Object.values(story.aiScores).length) : null,
        missingInformation: story.missingInformation ?? [],
        warnings: story.warnings ?? [],
        createdByAi: true,
        createdAt: new Date("2025-04-09T08:30:00Z"),
      })
      .returning();
    await db.insert(s.storyClusterMembers).values(subRows.map((r, i) => ({ clusterId: cluster.id, submissionId: r.id, similarity: i === 0 ? 1 : 0.82, isPrimary: i === 0, addedByAi: true })));
    for (const r of subRows) await db.update(s.submissions).set({ suggestedClusterId: cluster.id }).where(sql`${s.submissions.id} = ${r.id}`);

    // Story
    const scoreTotal = cluster.aiScoreTotal;
    const [storyRow] = await db
      .insert(s.stories)
      .values({
        editionId: edition.id,
        clusterId: cluster.id,
        sectionId: section.id,
        title: story.title,
        slug: story.key,
        status: story.status,
        storyType: story.storyType as typeof s.stories.$inferInsert.storyType,
        summary: story.standfirst ?? null,
        eventDate: null,
        priority: story.priority ?? 50,
        isCover: !!story.isCover,
        isSpotlight: !!story.isSpotlight,
        aiScores: cluster.aiScores,
        editorialScore: scoreTotal,
        aiNotes: story.warnings?.map((w) => w.message) ?? [],
        editorialNotes: story.editorialNotes ?? null,
        warnings: story.warnings ?? [],
        missingInformation: story.missingInformation ?? [],
        assignedToUserId: storyIndex % 2 === 0 ? editor.id : eic.id,
        suggestedTemplate: story.template ?? "ARTICLE_TWO_COLUMN",
        targetLength: story.targetLength ?? "MEDIUM",
        createdAt: new Date("2025-04-09T09:00:00Z"),
      })
      .returning();
    storyByKey.set(story.key, storyRow);
    if (campusIds.length) await db.insert(s.storyCampuses).values(campusIds.map((campusId) => ({ storyId: storyRow.id, campusId })));
    if (storyAssets.length) await db.insert(s.storyMedia).values(storyAssets.map((m, i) => ({ storyId: storyRow.id, mediaAssetId: m.asset.id, role: m.role, sortOrder: i, addedByAi: i > 0 })));

    // People & organisations
    for (const person of story.people ?? []) {
      const key = normalizeName(person.name);
      let row = peopleByName.get(key);
      if (!row) {
        [row] = await db.insert(s.people).values({ fullName: person.name, normalizedName: key, role: person.role === "JURY" ? "Jury member" : null, campusId: person.campus ? campusBySlug.get(person.campus)!.id : null, programId: person.program ? programByCode.get(person.program)?.id ?? null : null, mentionsCount: 0 }).returning();
        peopleByName.set(key, row);
      }
      await db.insert(s.storyPeople).values({ storyId: storyRow.id, personId: row.id, role: person.role, sourceSubmissionId: subRows[0]?.id ?? null }).onConflictDoNothing();
      await db.update(s.people).set({ mentionsCount: sql`${s.people.mentionsCount} + 1` }).where(sql`${s.people.id} = ${row.id}`);
    }
    for (const org of story.organisations ?? []) {
      const key = normalizeName(org.name);
      let row = orgByName.get(key);
      if (!row) {
        const logo = story.bdd?.logo && story.bdd.companyName === org.name ? mediaByFile.get(story.bdd.logo) : undefined;
        [row] = await db.insert(s.organisations).values({ name: org.name, normalizedName: key, type: org.type, logoAssetId: logo?.id ?? null }).returning();
        orgByName.set(key, row);
      }
      await db.insert(s.storyOrganisations).values({ storyId: storyRow.id, organisationId: row.id, role: org.role }).onConflictDoNothing();
      await db.update(s.organisations).set({ mentionsCount: sql`${s.organisations.mentionsCount} + 1` }).where(sql`${s.organisations.id} = ${row.id}`);
    }

    // Facts & quotes
    const factRows = story.facts.length
      ? await db
          .insert(s.facts)
          .values(
            story.facts.map((f) => ({
              editionId: edition.id,
              storyId: storyRow.id,
              clusterId: cluster.id,
              statement: f.statement,
              category: f.category,
              sourceSubmissionId: f.sourceIndex !== undefined ? subRows[f.sourceIndex]?.id ?? null : null,
              sourceExcerpt: f.excerpt ?? null,
              confidence: f.confidence,
              status: f.confidence === "CONFLICTING" ? ("DISPUTED" as const) : ("ACTIVE" as const),
              conflictGroup: f.conflictGroup ?? null,
              notes: f.notes ?? null,
              verifiedById: f.confidence === "VERIFIED_BY_SUBMISSION" && story.articleStatus === "APPROVED" ? editor.id : null,
              verifiedAt: f.confidence === "VERIFIED_BY_SUBMISSION" && story.articleStatus === "APPROVED" ? new Date("2025-04-12T10:00:00Z") : null,
              createdByAi: true,
            })),
          )
          .returning()
      : [];
    const quoteRows = story.quotes?.length
      ? await db
          .insert(s.quotes)
          .values(
            story.quotes.map((qu) => ({
              editionId: edition.id,
              storyId: storyRow.id,
              clusterId: cluster.id,
              text: qu.text,
              speakerName: qu.speaker ?? null,
              speakerRole: qu.role ?? null,
              sourceSubmissionId: qu.sourceIndex !== undefined ? subRows[qu.sourceIndex]?.id ?? null : subRows[0]?.id ?? null,
              isPullQuoteCandidate: !!qu.pullQuote,
              aiScore: qu.pullQuote ? 0.9 : 0.6,
              isApproved: story.articleStatus === "APPROVED",
              createdByAi: true,
            })),
          )
          .returning()
      : [];

    // Business Deep Dive satellite
    if (story.bdd) {
      const bdd = story.bdd;
      await db.insert(s.businessDeepDives).values({
        storyId: storyRow.id,
        editionId: edition.id,
        organisationId: orgByName.get(normalizeName(bdd.companyName))?.id ?? null,
        companyName: bdd.companyName,
        programCode: bdd.programCode,
        campusId: campusBySlug.get(bdd.campus)?.id ?? null,
        cohortLabel: bdd.cohortLabel,
        dateText: bdd.dateText ?? null,
        theCase: bdd.theCase ?? null,
        theData: bdd.theData ?? null,
        theChallenge: bdd.theChallenge ?? null,
        theApproach: bdd.theApproach ?? null,
        theMethods: bdd.theMethods ?? null,
        theSolution: bdd.theSolution ?? null,
        theResults: bdd.theResults ?? null,
        keyTakeaways: bdd.keyTakeaways ?? [],
        winningTeam: bdd.winningTeam,
        finalists: bdd.finalists ?? [],
        jury: bdd.jury ?? [],
        technologies: bdd.technologies ?? [],
        metrics: bdd.metrics ?? [],
        logoAssetId: bdd.logo ? mediaByFile.get(bdd.logo)?.id ?? null : null,
        teamPhotoAssetId: bdd.teamPhoto ? mediaByFile.get(bdd.teamPhoto)?.id ?? null : null,
        dashboardAssetId: bdd.dashboard ? mediaByFile.get(bdd.dashboard)?.id ?? null : null,
        diagramAssetId: bdd.diagram ? mediaByFile.get(bdd.diagram)?.id ?? null : null,
        quoteId: quoteRows.find((qr) => qr.isPullQuoteCandidate)?.id ?? null,
      });
    }

    // Event
    if (story.event) {
      await db.insert(s.events).values({
        editionId: edition.id,
        storyId: storyRow.id,
        title: story.event.title,
        dateText: story.event.dateText,
        location: story.event.location ?? null,
        campusId: story.event.campus ? campusBySlug.get(story.event.campus)!.id : null,
        isUpcoming: story.event.isUpcoming,
        signupUrl: story.event.signupUrl ?? null,
        organiser: story.event.organiser ?? null,
        sourceSubmissionId: subRows[0]?.id ?? null,
      });
    }

    // Article + revisions + provenance
    const primarySourceIds = subRows.filter((r) => r.status !== "DUPLICATE").map((r) => r.id);
    const body = story.body.map((block) => ("sources" in block && !block.sources ? { ...block, sources: primarySourceIds } : block));
    const wordCount = countWords(body);
    const provenance: Record<string, { submissionIds: string[]; factIds?: string[] }> = {};
    for (const block of body) provenance[block.id] = { submissionIds: primarySourceIds, factIds: factRows.slice(0, 2).map((f) => f.id) };
    const isEmpty = story.articleStatus === "EMPTY";
    const aiDraftAt = new Date("2025-04-09T10:00:00Z");
    const editedAt = new Date("2025-04-14T15:00:00Z");
    const [article] = await db
      .insert(s.articles)
      .values({
        storyId: storyRow.id,
        editionId: edition.id,
        kicker: story.kicker ?? null,
        headline: isEmpty ? "" : story.headline,
        standfirst: isEmpty ? null : story.standfirst ?? null,
        byline: story.byline ?? null,
        authorContributorId: story.byline ? contributorRows.find((c) => `${c.firstName} ${c.lastName}` === story.byline)?.id ?? null : null,
        body: isEmpty ? [] : body,
        tags: [story.section, ...story.campuses],
        language: "en",
        wordCount: isEmpty ? 0 : wordCount,
        status: story.articleStatus,
        currentRevision: isEmpty ? 0 : story.articleStatus === "AI_DRAFT" ? 1 : 2,
        provenance,
        warnings: story.warnings ?? [],
        headlineAlternatives: isEmpty ? [] : [story.title, story.headline],
        aiDraftedAt: isEmpty ? null : aiDraftAt,
        lastEditedById: story.articleStatus === "AI_DRAFT" || isEmpty ? null : editor.id,
        lastEditedAt: story.articleStatus === "AI_DRAFT" || isEmpty ? null : editedAt,
        approvedById: story.articleStatus === "APPROVED" ? eic.id : null,
        approvedAt: story.articleStatus === "APPROVED" ? new Date("2025-04-16T11:00:00Z") : null,
        manualEditRatio: story.articleStatus === "AI_DRAFT" || isEmpty ? null : 0.18 + (storyIndex % 4) * 0.05,
        createdAt: aiDraftAt,
      })
      .returning();
    articleByStoryKey.set(story.key, article);
    if (!isEmpty) {
      await db.insert(s.articleRevisions).values({ articleId: article.id, version: 1, kicker: story.kicker ?? null, headline: story.title, standfirst: story.standfirst ?? null, byline: story.byline ?? null, body, wordCount, createdByAi: true, changeSummary: "AI draft from the fact sheet", createdAt: aiDraftAt });
      if (story.articleStatus !== "AI_DRAFT") {
        await db.insert(s.articleRevisions).values({ articleId: article.id, version: 2, kicker: story.kicker ?? null, headline: story.headline, standfirst: story.standfirst ?? null, byline: story.byline ?? null, body, wordCount, createdById: editor.id, createdByAi: false, changeSummary: "Editorial pass: headline, standfirst, house style", createdAt: editedAt });
      }
      await db.insert(s.articleSources).values(subRows.map((r) => ({ articleId: article.id, submissionId: r.id, role: r.status === "DUPLICATE" ? "SUPPORTING" : "PRIMARY" })));
      const draftIn = 1800 + wordCount * 3;
      aiJobRows.push(
        { service: "fact_sheet", provider: "openai", model: "gpt-4.1", promptKey: "fact_sheet", promptVersion: 1, editionId: edition.id, entityType: "CLUSTER", entityId: cluster.id, status: "SUCCEEDED", inputRefs: { clusterId: cluster.id }, inputHash: `seed-fact-${cluster.id.slice(0, 8)}`, output: { facts: story.facts.length, quotes: story.quotes?.length ?? 0 }, confidence: 0.84, latencyMs: 6400, inputTokens: draftIn, outputTokens: 700, costCents: String(estimateCostCents("gpt-4.1", draftIn, 700)), attempts: 1, createdAt: new Date("2025-04-09T09:30:00Z"), completedAt: new Date("2025-04-09T09:30:07Z") },
        { service: "article_drafter", provider: "openai", model: "gpt-4.1", promptKey: "article_drafter", promptVersion: 1, editionId: edition.id, entityType: "ARTICLE", entityId: article.id, status: "SUCCEEDED", inputRefs: { storyId: storyRow.id }, inputHash: `seed-draft-${article.id.slice(0, 8)}`, output: { blocks: body.length }, confidence: 0.8, latencyMs: 11800, inputTokens: draftIn + 400, outputTokens: wordCount * 2, costCents: String(estimateCostCents("gpt-4.1", draftIn + 400, wordCount * 2)), attempts: 1, createdAt: aiDraftAt, completedAt: new Date(aiDraftAt.getTime() + 12000) },
      );
    }
  }

  // Stamped with the workspace and the person, and spread over the last three weeks, so the
  // console's cost views have something true to show on a fresh install rather than a blank month.
  const aiActor = userRows.find((u) => u.email === "eic@albertschool.com") ?? userRows[0];
  const seededAt = new Date();
  await db.insert(s.aiJobs).values(
    aiJobRows.map((row, i) => {
      const createdAt = at(seededAt, -(1 + (i % 21)), -(i % 9), -((i * 7) % 60));
      return { ...row, organizationId: org.id, userId: aiActor.id, createdAt, completedAt: new Date(createdAt.getTime() + (row.latencyMs ?? 1000)) };
    }),
  );

  // Cover
  const coverAsset = await ingestFile(SEED_COVER.media, { caption: "Cover — Special issue N°1", kind: "photo", rights: "GREEN" });
  const coverStory = storyByKey.get("bdd-carrefour-b2")!;
  await db.update(s.editions).set({ coverStoryId: coverStory.id, coverMediaAssetId: coverAsset.id }).where(sql`${s.editions.id} = ${edition.id}`);
  await db.insert(s.storyMedia).values({ storyId: coverStory.id, mediaAssetId: coverAsset.id, role: "cover", sortOrder: 99, addedByAi: false }).onConflictDoNothing();

  // ── Flatplan ───────────────────────────────────────────────────────────────
  const [plan] = await db.insert(s.pagePlans).values({ editionId: edition.id, name: "Flatplan", status: "DRAFT", pageSize: "A4", pageCount: SEED_FLATPLAN.length, generatedByAi: true, isActive: true, createdById: editor.id }).returning();
  await db.insert(s.pagePlanPages).values(
    SEED_FLATPLAN.map((pg, i) => {
      const storyRows = (pg.stories ?? []).map((k) => storyByKey.get(k)!);
      const articleRows = (pg.stories ?? []).map((k) => articleByStoryKey.get(k)!);
      const template = templateByCode(pg.template);
      const contentWords = articleRows.reduce((n, a) => n + a.wordCount, 0);
      const ratio = template.capacityWords ? contentWords / template.capacityWords : 0;
      const mediaIds = pg.media ? pg.media.map((f) => mediaByFile.get(f)!.id) : [];
      const warnings = ratio > 1.15 ? [{ code: "TEXT_OVERFLOW_RISK", message: `About ${contentWords} words for a ${template.capacityWords}-word template; the article will continue on an extra page.`, severity: "warning" as const }] : [];
      return {
        planId: plan.id,
        pageNumber: i + 1,
        sectionId: sectionBySlug.get(pg.section)?.id ?? null,
        template: pg.template,
        storyId: storyRows[0]?.id ?? null,
        articleId: articleRows[0]?.id ?? null,
        storyIds: storyRows.map((r) => r.id),
        mediaAssetIds: mediaIds,
        isLocked: !!pg.locked,
        fitEstimate: { capacityWords: template.capacityWords, contentWords, ratio: Math.round(ratio * 100) / 100, overflow: ratio > 1.15, imagesSlots: template.imageSlots, imagesUsed: Math.min(template.imageSlots, mediaIds.length || storyRows.length) },
        warnings,
      };
    }),
  );

  // ── Automation runs, notifications, audit ─────────────────────────────────
  const steps: { step: typeof s.automationRuns.$inferInsert.step; when: Date; summary: Record<string, unknown> }[] = [
    { step: "EDITION_CREATION", when: new Date("2025-03-28T09:00:00Z"), summary: { editionId: edition.id } },
    { step: "CAMPAIGN_OPEN", when: opensAt, summary: { invitations: SEED_CONTRIBUTORS.length } },
    { step: "REMINDER_1", when: new Date("2025-04-04T07:00:00Z"), summary: { reminded: SEED_CONTRIBUTORS.length - contributorsWithSubmissions.size } },
    { step: "REMINDER_2", when: new Date("2025-04-07T07:00:00Z"), summary: { reminded: SEED_CONTRIBUTORS.length - contributorsWithSubmissions.size } },
    { step: "GRACE_PERIOD", when: new Date("2025-04-08T07:00:00Z"), summary: { reminded: 3 } },
    { step: "CAMPAIGN_CLOSE", when: new Date("2025-04-08T22:00:00Z"), summary: { submissions: SEED_STORIES.reduce((n, st) => n + st.submissions.length, 0) } },
    { step: "AI_PROCESSING", when: new Date("2025-04-09T08:00:00Z"), summary: { clusters: SEED_STORIES.length, aiCostCents: aiJobRows.reduce((n, j) => n + Number(j.costCents ?? 0), 0) } },
    { step: "EDITORIAL_ALERT", when: new Date("2025-04-09T10:30:00Z"), summary: { notified: 2 } },
    { step: "COVERAGE_CHECK", when: new Date("2025-04-09T10:31:00Z"), summary: { underrepresented: ["geneva"] } },
  ];
  await db.insert(s.automationRuns).values(steps.map((st) => ({ organizationId, editionId: edition.id, step: st.step, runKey: `${edition.id}:${st.step}`, status: "SUCCEEDED", triggeredBy: "SCHEDULER", scheduledFor: st.when, startedAt: st.when, finishedAt: new Date(st.when.getTime() + 4000), summary: st.summary, createdAt: st.when })));

  const flagged = SEED_STORIES.filter((st) => (st.warnings ?? []).length || (st.missingInformation ?? []).length).length;
  for (const user of [admin, eic, editor]) {
    await db.insert(s.notifications).values([
      { organizationId, userId: user.id, type: "PROCESSING_COMPLETED", title: "AI processing finished for May 2025", body: `${SEED_STORIES.length} story clusters created from ${SEED_STORIES.reduce((n, st) => n + st.submissions.length, 0)} submissions.`, entityType: "EDITION", entityId: edition.id, href: `/editions/${edition.id}`, createdAt: new Date("2025-04-09T10:30:00Z") },
      { organizationId, userId: user.id, type: "FACTUAL_CONFLICT", title: `${flagged} stories need attention`, body: "Conflicting names and missing information were detected. Review the flags before layout.", entityType: "EDITION", entityId: edition.id, href: `/editions/${edition.id}/stories?flag=needs_attention`, createdAt: new Date("2025-04-09T10:31:00Z") },
      { organizationId, userId: user.id, type: "LOW_CAMPUS_COVERAGE", title: "Geneva is under-represented", body: "Only 1 submission mentions the Geneva campus. Consider requesting a contribution from the Geneva ambassadors.", entityType: "EDITION", entityId: edition.id, href: `/editions/${edition.id}/inbox?campus=geneva`, createdAt: new Date("2025-04-09T10:32:00Z") },
      { organizationId, userId: user.id, type: "DEADLINE_APPROACHING", title: "Final editorial review — 12 May, 18:00", body: "18 of 26 articles are approved.", entityType: "EDITION", entityId: edition.id, href: `/editions/${edition.id}/articles`, createdAt: new Date("2025-05-10T08:00:00Z") },
    ]);
  }

  await db.insert(s.auditLog).values([
    { organizationId, actorType: "USER", userId: admin.id, action: "edition.create", entityType: "EDITION", entityId: edition.id, editionId: edition.id, metadata: { issueNumber: 1 }, createdAt: new Date("2025-03-28T09:00:00Z") },
    { organizationId, actorType: "SYSTEM", action: "campaign.open", entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, metadata: { invitations: SEED_CONTRIBUTORS.length }, createdAt: opensAt },
    { organizationId, actorType: "SYSTEM", action: "campaign.close", entityType: "CAMPAIGN", entityId: campaign.id, editionId: edition.id, metadata: {}, createdAt: new Date("2025-04-08T22:00:00Z") },
    { organizationId, actorType: "AI", action: "edition.process", entityType: "EDITION", entityId: edition.id, editionId: edition.id, metadata: { clusters: SEED_STORIES.length }, createdAt: new Date("2025-04-09T10:30:00Z") },
    { organizationId, actorType: "USER", userId: editor.id, action: "edition.transition", entityType: "EDITION", entityId: edition.id, editionId: edition.id, metadata: { from: "PROCESSING", to: "EDITORIAL_REVIEW" }, createdAt: new Date("2025-04-09T11:00:00Z") },
  ]);

  // Update contributor stats
  for (const c of SEED_CONTRIBUTORS) {
    const contributor = contributorByKey.get(c.key)!;
    const count = SEED_STORIES.reduce((n, st) => n + st.submissions.filter((sub) => sub.contributor === c.key).length, 0);
    await db
      .update(s.contributors)
      .set({ invitationsCount: 1, submissionsCount: count, responseRate: count > 0 ? 1 : 0, lastInvitedAt: opensAt, lastContributionAt: count > 0 ? new Date("2025-04-05T10:00:00Z") : null })
      .where(sql`${s.contributors.id} = ${contributor.id}`);
  }

  // ── Edition 2: Issue N°2 — October 2026 (upcoming, campaign scheduled) ────
  const [next] = await db
    .insert(s.editions)
    .values({
      organizationId,
      publicationId: publication.id,
      issueNumber: 2,
      title: "Albert's Deep Dive — Issue N°2",
      slug: "issue-2-october-2026",
      label: "October 2026",
      month: 10,
      year: 2026,
      status: "UPCOMING",
      publicationTargetAt: new Date("2026-10-15T10:00:00Z"),
      finalReviewAt: new Date("2026-10-11T16:00:00Z"),
      pageSize: "A4",
      targetPageCount: 24,
      editorInChiefId: eic.id,
      createdById: admin.id,
    })
    .returning();
  await db.insert(s.editionSections).values(DEFAULT_SECTIONS.map((sec, i) => ({ editionId: next.id, slug: sec.slug, name: sec.name, kicker: sec.kicker, colour: sec.colour, sortOrder: i, targetPages: sec.targetPages })));
  await db.insert(s.submissionCampaigns).values({
    editionId: next.id,
    name: "October 2026 contributions",
    status: "SCHEDULED",
    opensAt: new Date("2026-10-01T07:00:00Z"),
    reminder1At: new Date("2026-10-04T07:00:00Z"),
    reminder2At: new Date("2026-10-07T07:00:00Z"),
    deadlineAt: new Date("2026-10-07T21:59:00Z"),
    graceEndsAt: new Date("2026-10-08T21:59:00Z"),
    targets: { [campusBySlug.get("paris")!.id]: 20, [campusBySlug.get("lyon")!.id]: 10, [campusBySlug.get("marseille")!.id]: 10, [campusBySlug.get("geneva")!.id]: 5 },
    contributorGroupIds: groupRows.filter((g) => ["paris-ambassadors", "lyon-ambassadors", "marseille-ambassadors", "geneva-ambassadors", "associations", "bdd-representatives", "student-entrepreneurs", "administration"].includes(g.slug)).map((g) => g.id),
    introMessage: "The new academic year has started: tell us about your first Business Deep Dives, your associations and your campus.",
    /*
     * The next issue asks last issue's contributors again, which is both realistic and necessary.
     *
     * Every contributor in these groups wrote for May, so with re-invites off this campaign is
     * correctly allowed to invite nobody — and a demo whose one launchable campaign sends zero
     * invitations teaches the wrong thing about the product. A school with four campuses and a
     * standing group of ambassadors does ask them again; the rule exists for the case where the
     * newsroom wants fresh voices, not as the default for a returning cohort.
     */
    reinvitePrevious: true,
    createdById: editor.id,
  });
  await db.insert(s.automationRuns).values({ editionId: next.id, step: "EDITION_CREATION", runKey: `${next.id}:EDITION_CREATION`, status: "SUCCEEDED", triggeredBy: "SCHEDULER", scheduledFor: new Date("2026-09-01T07:00:00Z"), startedAt: new Date("2026-09-01T07:00:00Z"), finishedAt: new Date("2026-09-01T07:00:02Z"), summary: { editionId: next.id }, createdAt: new Date("2026-09-01T07:00:00Z") });

  const counts = {
    stories: SEED_STORIES.length,
    submissions: SEED_STORIES.reduce((n, st) => n + st.submissions.length, 0),
    media: mediaByFile.size,
    templates: PAGE_TEMPLATES.length,
    contributors: SEED_CONTRIBUTORS.length,
    credits: SEED_CREDITS.length,
  };
  // ── The public gallery ─────────────────────────────────────────────────────
  // Briefly's own demo workspaces, so /collections has something on a fresh install. Albert School
  // is a customer and stays out of it until somebody there says otherwise.
  const showcase = await seedShowcase(admin.id);
  say(`[seed] gallery: ${showcase.collections} collections, ${showcase.editions} demo editions from ${showcase.organizations} Briefly workspaces`);

  say("[seed] done", counts);
  say(`[seed] sign in with ${env.SEED_ADMIN_EMAIL} / ${env.SEED_ADMIN_PASSWORD} (all demo accounts share this password: eic@, editor@, lyon@, viewer@albertschool.com)`);
  return { editionId: edition.id, nextEditionId: next.id, adminEmail: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD };
}
