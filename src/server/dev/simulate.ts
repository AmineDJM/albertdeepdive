import { promises as fs } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { campuses, consentRecords, contributors, editions, submissionAttachments, submissionCampuses, submissions } from "@/server/db/schema";
import { getCampaignForEdition } from "@/server/campaigns/service";
import { ingestMedia } from "@/server/media/ingest";
import { audit } from "@/server/audit";
import { createLogger } from "@/server/logger";
import { CONSENT_TEXT_VERSION } from "@/lib/constants";
import { NotFoundError } from "@/lib/action-result";

const log = createLogger("dev:simulate");

/**
 * A super-admin demo tool: it fabricates realistic contribution-form submissions for an edition so
 * an editor can watch the whole issue take shape and see the rendered result, without waiting for
 * real students to answer. The fakes are inserted exactly like real form intake (status NEW,
 * un-processed) so the normal AI pipeline clusters, drafts and lays them out. Nothing here sends an
 * email or touches production data beyond the target edition.
 */

type Scope = "single" | "multi" | "school";

type FakeTemplate = {
  storyType: string;
  title: string;
  description: string;
  peopleInvolved?: string;
  organisationsInvolved?: string;
  whyItMatters?: string;
  quotes?: string;
  scope: Scope;
  photo?: boolean;
};

/**
 * Hand-authored, English, business-school-flavoured submissions. A few deliberately share strong
 * entities (Carrefour BDD ×2, the AI hackathon ×2) so the clusterer folds them into one story —
 * the rest are singletons, giving a varied flat-plan across sections.
 */
const TEMPLATES: FakeTemplate[] = [
  {
    storyType: "BUSINESS_DEEP_DIVE",
    title: "Carrefour promo-uplift model wins the B2 Deep Dive",
    description:
      "Our team spent three weeks forecasting the sales uplift of in-store promotions for Carrefour. We built a LightGBM model on two years of transaction data and shipped a Streamlit dashboard that category managers can actually use. The jury liked that we quantified cannibalisation between promoted and regular SKUs.",
    peopleInvolved: "Anna Spira, Sacha Nardoux, Maxtime Le Guen",
    organisationsInvolved: "Carrefour",
    whyItMatters: "It is the first Business Deep Dive of the year and set the bar for the promotion-analytics track.",
    quotes: "“We didn't just predict the uplift, we explained where it came from,” said Anna Spira.",
    scope: "single",
    photo: true,
  },
  {
    storyType: "BUSINESS_DEEP_DIVE",
    title: "Behind the Carrefour dashboard: how team B2 handled the messy data",
    description:
      "A second write-up from the Carrefour Business Deep Dive, focused on the data-engineering side. Half of our three weeks went into reconciling loyalty-card identifiers and store calendars before any model could run. We documented the pipeline so next year's cohort can reuse it.",
    peopleInvolved: "Sacha Nardoux, Anna Spira",
    organisationsInvolved: "Carrefour",
    whyItMatters: "Shows the unglamorous data work behind a winning Deep Dive.",
    scope: "single",
    photo: false,
  },
  {
    storyType: "STUDENT_ACHIEVEMENT",
    title: "Two B1 students place second at the Paris FinTech datathon",
    description:
      "Léa and Tom represented Albert School at the Paris FinTech datathon and finished second out of thirty-one teams, building a fraud-scoring prototype in under 48 hours. They were the only first-year team on the podium.",
    peopleInvolved: "Léa Fontaine, Tom Berger",
    whyItMatters: "A rare podium finish for first-years against master's-level competition.",
    quotes: "“We slept four hours and it was worth it,” Tom laughed.",
    scope: "single",
    photo: true,
  },
  {
    storyType: "ASSOCIATION",
    title: "The Data & Society club doubles its membership",
    description:
      "Our student association ran an open-doors week with beginner Python clinics and a talk on algorithmic bias. We went from 40 to 95 active members and are launching a monthly reading group on responsible AI.",
    organisationsInvolved: "Data & Society",
    whyItMatters: "Signals growing student appetite for ethics alongside technical skills.",
    scope: "single",
    photo: false,
  },
  {
    storyType: "EVENT_RECAP",
    title: "Albert Mind conference packs the amphitheatre",
    description:
      "The annual Albert Mind conference brought four founders and a venture partner to campus for an afternoon on building data-first companies. Around 300 students attended and the Q&A ran forty minutes over.",
    peopleInvolved: "Othmane Belkacem",
    organisationsInvolved: "Albert Mind",
    whyItMatters: "The school's flagship student-run conference, back at full capacity.",
    quotes: "“Ship something ugly this week,” one founder told the room.",
    scope: "school",
    photo: true,
  },
  {
    storyType: "STUDENT_PROJECT",
    title: "A student-built timetable optimiser saves the registrar hours",
    description:
      "For our operations-research project we modelled classroom allocation as a constraint-satisfaction problem and cut manual scheduling from two days to twenty minutes. The registrar is piloting it next semester.",
    peopleInvolved: "Inès Rahmani, Paul Descamps",
    whyItMatters: "A class project that a school department actually adopted.",
    scope: "single",
    photo: false,
  },
  {
    storyType: "INTERVIEW_PROFILE",
    title: "Meet the alum turning satellite images into crop forecasts",
    description:
      "We interviewed a 2023 graduate who now leads data science at an agri-tech startup, forecasting yields from satellite imagery for cooperatives across three countries. She talked about breaking into geospatial ML with no remote-sensing background.",
    peopleInvolved: "Clara Vasseur",
    whyItMatters: "A concrete, inspiring path from the classroom to a hard applied-ML job.",
    quotes: "“The maths transfers; the domain you learn on the job,” she said.",
    scope: "school",
    photo: true,
  },
  {
    storyType: "DATA_AI_BUSINESS_INSIGHT",
    title: "What our survey says about AI use among students",
    description:
      "We surveyed 210 students on how they use generative AI for coursework. 78% use it weekly, mostly for debugging and explanation rather than writing, and a clear majority want explicit rules from professors rather than a ban.",
    whyItMatters: "Grounds the AI-in-education debate in local numbers instead of anecdotes.",
    scope: "multi",
    photo: false,
  },
  {
    storyType: "CAMPUS_LIFE",
    title: "The new rooftop study space is already the busiest on campus",
    description:
      "The renovated rooftop opened this month with power sockets, whiteboards and, crucially, good coffee nearby. It fills up by nine in the morning and has become the unofficial home of group projects.",
    whyItMatters: "A small change to campus life that students clearly love.",
    scope: "single",
    photo: true,
  },
  {
    storyType: "CAREER_INTERNSHIP",
    title: "Summer internships: where the cohort landed",
    description:
      "A round-up of this summer's internships across the cohort — from a Series-B fintech's data team to a public-sector analytics unit and a sports-analytics consultancy. Three interns received return offers before term started.",
    whyItMatters: "Useful, concrete signal for students choosing tracks next year.",
    scope: "multi",
    photo: false,
  },
  {
    storyType: "ALUMNI",
    title: "Alumni panel: five years out, five different paths",
    description:
      "Five graduates from the first cohorts came back to talk careers: a founder, a quant, a product manager, a data-journalism lead and a PhD student. The honest talk about pivots and setbacks resonated most.",
    whyItMatters: "Shows the range of destinations an Albert School degree opens up.",
    scope: "school",
    photo: false,
  },
  {
    storyType: "ACADEMIC_NEWS",
    title: "A new elective on causal inference joins the curriculum",
    description:
      "Starting next semester, a hands-on elective on causal inference will cover A/B testing, difference-in-differences and instrumental variables, taught with real business cases. Registration opened this week and the first section is already full.",
    whyItMatters: "Fills a real gap between correlation-heavy ML courses and business decision-making.",
    scope: "school",
    photo: false,
  },
  {
    storyType: "UPCOMING_EVENT",
    title: "Save the date: the spring data hackathon",
    description:
      "The spring hackathon is confirmed for the last weekend of March, with a mobility-data theme and a public transport operator as partner. Teams of three to five can register from next week; last year sold out in two days.",
    organisationsInvolved: "Data & Society",
    whyItMatters: "The biggest student build event of the semester — readers will want the date.",
    scope: "school",
    photo: false,
  },
  {
    storyType: "STUDENT_ACHIEVEMENT",
    title: "AI hackathon winners built a triage bot for a local clinic",
    description:
      "The winning team at the campus AI hackathon built a symptom-triage assistant for a partner health clinic, with careful guardrails so it always defers to a human. They are continuing it as a semester project.",
    peopleInvolved: "Yasmine Cherif, Noah Klein, Diego Moreau",
    whyItMatters: "A hackathon project with a real, responsible use case beyond the weekend.",
    quotes: "“The hard part wasn't the model, it was deciding when it should stay silent,” said Noah.",
    scope: "single",
    photo: true,
  },
  {
    storyType: "STUDENT_PROJECT",
    title: "How the AI hackathon runners-up mapped campus noise",
    description:
      "A second AI-hackathon story: the runners-up wired cheap sound sensors around the library and built a live heat-map of quiet zones. It is now a small open-source project other students are contributing to.",
    peopleInvolved: "Diego Moreau, Yasmine Cherif",
    whyItMatters: "Turns a weekend build into a shared campus utility.",
    scope: "single",
    photo: false,
  },
  {
    storyType: "PHOTO_STORY",
    title: "In pictures: welcome week for the new cohort",
    description:
      "A photo story from welcome week — the campus tour, the first team-building challenge and the traditional group photo on the steps. The new cohort is the largest yet.",
    whyItMatters: "A warm, visual opener that captures the start of the year.",
    scope: "school",
    photo: true,
  },
];

function wordCount(parts: (string | undefined)[]): number {
  return parts
    .filter(Boolean)
    .join("\n")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Best-effort list of seed photos to borrow for attachments; empty if the folder isn't shipped. */
async function seedPhotos(): Promise<string[]> {
  try {
    const dir = path.join(process.cwd(), "seed", "media");
    const files = await fs.readdir(dir);
    return files.filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

export type SimulateResult = { created: number; withPhotos: number; clustersHint: number };

/**
 * Inserts `count` fake submissions into the edition. Optionally borrows seed photos as attachments
 * so the media pipeline and the rights gates have something to chew on.
 */
export async function simulateSubmissions(
  editionId: string,
  opts: { count?: number; attachPhotos?: boolean; userId?: string | null } = {},
): Promise<SimulateResult> {
  const count = Math.max(1, Math.min(opts.count ?? 12, 60));
  const attachPhotos = opts.attachPhotos ?? true;

  const edition = await db.query.editions.findFirst({ where: eq(editions.id, editionId) });
  if (!edition) throw new NotFoundError("Edition");
  const campaign = await getCampaignForEdition(editionId);

  const [campusRows, contributorRows] = await Promise.all([
    db.select({ id: campuses.id, name: campuses.name }).from(campuses).where(eq(campuses.isActive, true)),
    db
      .select({ id: contributors.id, firstName: contributors.firstName, lastName: contributors.lastName, email: contributors.email, campusId: contributors.campusId })
      .from(contributors)
      .where(eq(contributors.isActive, true))
      .limit(300),
  ]);
  const people = shuffle(contributorRows);
  const photoPool = attachPhotos ? shuffle(await seedPhotos()) : [];

  let created = 0;
  let withPhotos = 0;
  let photoCursor = 0;

  for (let i = 0; i < count; i += 1) {
    const template = TEMPLATES[i % TEMPLATES.length];
    const contributor = people.length ? people[i % people.length] : null;
    const now = Date.now();
    const submittedAt = new Date(now - Math.floor(Math.random() * 6 * 24 * 3600_000)); // within the last ~6 days

    // Resolve the campus(es) this submission belongs to.
    let campusScope: "SINGLE" | "MULTI" | "SCHOOL_WIDE" = "SINGLE";
    let campusIds: string[] = [];
    if (template.scope === "school" || campusRows.length === 0) {
      campusScope = "SCHOOL_WIDE";
    } else if (template.scope === "multi" && campusRows.length > 1) {
      campusScope = "MULTI";
      campusIds = shuffle(campusRows).slice(0, 2).map((c) => c.id);
    } else {
      campusScope = "SINGLE";
      const home = contributor?.campusId ?? shuffle(campusRows)[0]?.id ?? null;
      campusIds = home ? [home] : [];
      if (!home) campusScope = "SCHOOL_WIDE";
    }

    const willHavePhoto = attachPhotos && !!template.photo && photoCursor < photoPool.length;

    try {
      const [submission] = await db
        .insert(submissions)
        .values({
          editionId,
          campaignId: campaign?.id ?? null,
          contributorId: contributor?.id ?? null,
          storyType: template.storyType as typeof submissions.$inferInsert.storyType,
          title: template.title,
          description: template.description,
          peopleInvolved: template.peopleInvolved ?? null,
          organisationsInvolved: template.organisationsInvolved ?? null,
          whyItMatters: template.whyItMatters ?? null,
          quotes: template.quotes ?? null,
          campusScope,
          contactName: contributor ? `${contributor.firstName} ${contributor.lastName}` : null,
          contactEmail: contributor?.email ?? null,
          language: "en",
          status: "NEW",
          source: "simulated",
          publicationConsent: true,
          imageRightsConfirmed: willHavePhoto,
          consentTextVersion: CONSENT_TEXT_VERSION,
          wordCount: wordCount([template.description, template.peopleInvolved, template.organisationsInvolved, template.whyItMatters, template.quotes]),
          submittedAt,
        })
        .returning({ id: submissions.id });

      if (campusIds.length) {
        await db.insert(submissionCampuses).values(campusIds.map((campusId) => ({ submissionId: submission.id, campusId }))).onConflictDoNothing();
      }

      const consents: (typeof consentRecords.$inferInsert)[] = [{ submissionId: submission.id, contributorId: contributor?.id ?? null, type: "PUBLICATION", textVersion: CONSENT_TEXT_VERSION, acceptedAt: submittedAt }];
      if (willHavePhoto) consents.push({ submissionId: submission.id, contributorId: contributor?.id ?? null, type: "IMAGE_RIGHTS", textVersion: CONSENT_TEXT_VERSION, acceptedAt: submittedAt });
      await db.insert(consentRecords).values(consents);

      if (willHavePhoto) {
        const file = photoPool[photoCursor];
        photoCursor += 1;
        try {
          const buffer = await fs.readFile(file);
          const { asset } = await ingestMedia({
            buffer,
            fileName: path.basename(file),
            editionId,
            submissionId: submission.id,
            contributorId: contributor?.id ?? null,
            caption: template.title,
            photographer: contributor ? `${contributor.firstName} ${contributor.lastName}` : "Newsroom",
            rightsStatus: "YELLOW",
            skipDuplicateCheck: true,
          });
          await db.insert(submissionAttachments).values({
            submissionId: submission.id,
            mediaAssetId: asset.id,
            kind: "IMAGE",
            fileName: asset.fileName,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            storageKey: asset.storageKey,
            caption: template.title,
            sortOrder: 0,
          });
          withPhotos += 1;
        } catch (err) {
          log.warn("photo attach failed, submission kept without it", { err, file });
        }
      }

      created += 1;
    } catch (err) {
      log.error("failed to insert a simulated submission", { err, template: template.title });
    }
  }

  await audit({
    action: "edition.simulate_submissions",
    userId: opts.userId ?? undefined,
    entityType: "EDITION",
    entityId: editionId,
    editionId,
    metadata: { requested: count, created, withPhotos },
  });
  log.info("simulated submissions", { editionId, created, withPhotos });

  return { created, withPhotos, clustersHint: Math.ceil(created / 1.4) };
}
