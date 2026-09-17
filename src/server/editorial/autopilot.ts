import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { articles, editions, stories, storyMedia } from "@/server/db/schema";
import { getCampaignForEdition, closeCampaign } from "@/server/campaigns/service";
import { processEdition } from "@/server/ai/pipeline";
import { draftArticle, approveArticle } from "@/server/editorial/articles";
import { setCoverStory } from "@/server/editorial/stories";
import { regeneratePagePlan, setPlanStatus } from "@/server/publication/flatplan";
import { createPublicationVersion, renderVersion, publishEdition, overrideQualityGate } from "@/server/publication/versions";
import { canPublish } from "@/server/publication/validate";
import { transitionEdition, updateEdition } from "@/server/editions/service";
import { COLLECTION_STATUSES, type EditionStatus } from "@/lib/editorial/edition-state";
import { createLogger } from "@/server/logger";
import { NotFoundError } from "@/lib/action-result";

const log = createLogger("editorial:autopilot");

const AUTO_REASON = "Auto-approved by the one-click pilot";

export type AutopilotTarget = "organise" | "publish";
export type AutopilotStepStatus = "done" | "skipped" | "failed" | "blocked";
export type AutopilotStep = { key: string; label: string; status: AutopilotStepStatus; detail?: string };
export type AutopilotResult = { finalStatus: EditionStatus; published: boolean; steps: AutopilotStep[]; blockers: string[] };

async function editionStatus(editionId: string): Promise<EditionStatus> {
  const row = await db.query.editions.findFirst({ where: eq(editions.id, editionId), columns: { status: true } });
  if (!row) throw new NotFoundError("Edition");
  return row.status;
}

/**
 * The one-click pilot. It drives an edition from wherever it is all the way to a published issue —
 * closing the collection, running the AI processing, writing and approving every article, laying
 * the pages out, validating, exporting the PDF/DOCX and publishing — auto-approving the quality
 * gates it is allowed to. It never distributes the finished issue to any audience (there is no such
 * step in the system), so "publish" here means the issue is finalised and immutable, nothing is
 * emailed to readers.
 *
 * `target: "organise"` stops after the AI has turned submissions into stories (editorial review);
 * `target: "publish"` (default) goes all the way. Every stage is idempotent, so re-running is safe.
 */
export async function runAutopilot(editionId: string, user: { id: string; role: string }, opts: { target?: AutopilotTarget } = {}): Promise<AutopilotResult> {
  const target = opts.target ?? "publish";
  const steps: AutopilotStep[] = [];
  const blockers: string[] = [];
  const add = (key: string, label: string, status: AutopilotStepStatus, detail?: string) => steps.push({ key, label, status, detail });
  const finalize = async (published = false): Promise<AutopilotResult> => ({ finalStatus: await editionStatus(editionId), published, steps, blockers });

  let status = await editionStatus(editionId);
  if (status === "PUBLISHED" || status === "ARCHIVED") {
    add("state", "Edition is already published", "skipped");
    return finalize(true);
  }

  // ── Stage 1 · Close the collection (no invitations, no reader emails) ──────────────────────────
  try {
    if (status === "UPCOMING") {
      await transitionEdition(editionId, "OPEN", user.id, "autopilot");
      await transitionEdition(editionId, "CLOSED", user.id, "autopilot");
      add("close", "Collection closed", "done", "Opened and closed without sending invitations.");
    } else if (COLLECTION_STATUSES.includes(status)) {
      const campaign = await getCampaignForEdition(editionId);
      if (campaign && campaign.status !== "CLOSED") {
        await closeCampaign(campaign.id, { triggeredBy: "MANUAL", userId: user.id, skipProcessing: true });
        add("close", "Collection closed", "done", "Campaign closed; only contributors who submitted were thanked.");
      } else {
        await transitionEdition(editionId, "CLOSED", user.id, "autopilot");
        add("close", "Collection closed", "done");
      }
    } else {
      add("close", "Collection already closed", "skipped");
    }
  } catch (err) {
    add("close", "Could not close the collection", "failed", errMessage(err));
    blockers.push("Closing the collection failed");
    return finalize();
  }

  // ── Stage 2 · AI processing: submissions → clusters → stories ──────────────────────────────────
  status = await editionStatus(editionId);
  try {
    if (status === "CLOSED" || status === "PROCESSING") {
      const summary = await processEdition(editionId, { triggeredBy: "MANUAL", userId: user.id, force: status === "PROCESSING" });
      add("process", "Submissions organised into stories", "done", `${summary.submissionsProcessed} processed · ${summary.clustering?.groups ?? 0} clusters · ${summary.storiesCreated} stories`);
    } else {
      add("process", "Already organised", "skipped");
    }
  } catch (err) {
    add("process", "AI processing failed", "failed", errMessage(err));
    blockers.push("AI processing failed");
    return finalize();
  }

  if (target === "organise") return finalize();

  // ── Stage 3 · Write and approve every article ──────────────────────────────────────────────────
  const storyRows = await db.query.stories.findMany({
    where: and(eq(stories.editionId, editionId), inArray(stories.status, ["CANDIDATE", "SELECTED", "DRAFTING", "IN_REVIEW", "APPROVED"])),
    with: { article: { columns: { id: true, status: true } } },
    orderBy: [desc(stories.priority)],
    limit: 60,
  });
  let drafted = 0;
  let approved = 0;
  for (const story of storyRows) {
    try {
      let articleId = story.article?.id ?? null;
      const articleStatus = story.article?.status;
      if (!articleId || articleStatus === "EMPTY") {
        const res = await draftArticle(story.id, { userId: user.id });
        articleId = res.article.id;
        drafted += 1;
      }
      if (!articleId) continue;
      const current = await db.query.articles.findFirst({ where: eq(articles.id, articleId), columns: { status: true, headline: true, body: true } });
      if (current && current.status !== "APPROVED" && current.status !== "LOCKED" && current.headline.trim() && current.body.length) {
        await approveArticle(articleId, user.id, { force: true, reason: AUTO_REASON });
        approved += 1;
      }
    } catch (err) {
      log.warn("autopilot: story draft/approve skipped", { storyId: story.id, err });
    }
  }
  add("write", "Articles written and approved", "done", `${drafted} drafted · ${approved} approved`);

  // ── Stage 4 · Pick a cover ─────────────────────────────────────────────────────────────────────
  try {
    const approvedStories = await db.query.stories.findMany({ where: and(eq(stories.editionId, editionId), eq(stories.status, "APPROVED")), orderBy: [desc(stories.priority)], columns: { id: true, title: true } });
    if (approvedStories.length) {
      const heroes = await db.select({ storyId: storyMedia.storyId }).from(storyMedia).where(eq(storyMedia.role, "hero"));
      const withHero = new Set(heroes.map((h) => h.storyId));
      const cover = approvedStories.find((s) => withHero.has(s.id)) ?? approvedStories[0];
      await setCoverStory(editionId, cover.id, user.id);
      const coverArticle = await db.query.articles.findFirst({ where: eq(articles.storyId, cover.id), columns: { headline: true } });
      await updateEdition(editionId, { coverHeadline: (coverArticle?.headline || cover.title).slice(0, 200) }, user.id);
      add("cover", "Cover chosen", "done", cover.title);
    } else {
      add("cover", "No approved story to feature on the cover", "skipped");
    }
  } catch (err) {
    add("cover", "Could not set the cover", "failed", errMessage(err));
  }

  // ── Stage 5 · Flat-plan the issue and validate the layout ──────────────────────────────────────
  try {
    const plan = await regeneratePagePlan(editionId, { userId: user.id });
    status = await editionStatus(editionId);
    if (status === "EDITORIAL_REVIEW") await transitionEdition(editionId, "LAYOUT", user.id, "autopilot");
    await setPlanStatus(editionId, "VALIDATED", user.id);
    add("layout", "Flat-plan generated and validated", "done", `${plan.pages} pages`);
  } catch (err) {
    add("layout", "Layout failed", "failed", errMessage(err));
    blockers.push("Layout failed");
    return finalize();
  }

  // ── Stage 6 · Export the PDF and DOCX ──────────────────────────────────────────────────────────
  status = await editionStatus(editionId);
  try {
    if (status === "LAYOUT") await transitionEdition(editionId, "FINAL_REVIEW", user.id, "autopilot");
    const version = await createPublicationVersion(editionId, { kind: "PUBLISHED", userId: user.id });
    const rendered = await renderVersion(version.id);
    if (rendered.status !== "READY") {
      add("export", "Export failed", "failed", `Version ${version.label} is ${rendered.status.toLowerCase()}.`);
      blockers.push("PDF/DOCX export failed — check the exports tab");
      return finalize();
    }
    add("export", "PDF and DOCX generated", "done", version.label);

    // ── Stage 7 · Clear the quality gates the pilot is allowed to, then publish ──────────────────
    const check = await canPublish(editionId);
    if (!check.ok) {
      const overridable = check.blocking.filter((g) => g.overridable);
      const hard = check.blocking.filter((g) => !g.overridable);
      for (const g of overridable) await overrideQualityGate(editionId, g.key, AUTO_REASON, { id: user.id, role: user.role });
      if (overridable.length) add("gates", "Quality gates auto-approved", "done", overridable.map((g) => g.label).join(", "));
      if (hard.length) {
        add("gates", "Some gates cannot be auto-approved", "blocked", hard.map((g) => g.label).join(", "));
        hard.forEach((g) => blockers.push(g.label));
      }
    } else {
      add("gates", "All quality gates pass", "done");
    }

    const finalCheck = await canPublish(editionId);
    if (finalCheck.ok) {
      await publishEdition(editionId, version.id, user.id);
      add("publish", "Edition published", "done", "Finalised and locked — no email was sent to any reader.");
      return finalize(true);
    }
    add("publish", "Held back — quality gates still block publication", "blocked", finalCheck.blocking.map((g) => g.label).join(", "));
    finalCheck.blocking.forEach((g) => blockers.includes(g.label) || blockers.push(g.label));
    return finalize();
  } catch (err) {
    add("export", "Export or publication failed", "failed", errMessage(err));
    blockers.push(errMessage(err));
    return finalize();
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
