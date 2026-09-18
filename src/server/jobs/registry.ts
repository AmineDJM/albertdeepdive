import type { jobs } from "@/server/db/schema";

export type JobRecord = typeof jobs.$inferSelect;

export type JobContext = {
  job: JobRecord;
  workerId: string;
  /** Report progress; stored on the job row and visible in the UI. */
  progress: (done: number, total: number, message?: string) => Promise<void>;
  log: (message: string, meta?: Record<string, unknown>) => void;
};

export type JobHandler<P = Record<string, unknown>, R = unknown> = (payload: P, ctx: JobContext) => Promise<R>;

const handlers = new Map<string, JobHandler>();

export function registerJobHandler<P extends Record<string, unknown>, R>(type: string, handler: JobHandler<P, R>) {
  handlers.set(type, handler as unknown as JobHandler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

export function listJobTypes() {
  return [...handlers.keys()];
}

/** Well-known job types (string constants keep payloads serialisable and discoverable). */
export const JOB_TYPES = {
  CAMPAIGN_SEND_INVITATIONS: "campaign.send_invitations",
  CAMPAIGN_SEND_REMINDERS: "campaign.send_reminders",
  CAMPAIGN_CLOSE: "campaign.close",
  SUBMISSION_PROCESS: "submission.process",
  EDITION_PROCESS: "edition.process",
  STORY_DRAFT: "story.draft",
  MEDIA_PROCESS: "media.process",
  EDITION_EXPORT: "edition.export",
  AUTOMATION_TICK: "automation.tick",
  EMAIL_SEND: "email.send",
  EMAIL_DOMAIN_VERIFY: "email.domain.verify",
  INFO_REQUEST_SEND: "info_request.send",
  CREATIVE_RENDER: "creative.render",
  SPEECH_NARRATE: "speech.narrate",
  IMAGE_RENDER: "image.render",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
