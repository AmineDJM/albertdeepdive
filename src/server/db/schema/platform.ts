import { boolean, index, integer, jsonb, numeric, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { actorTypeEnum, aiJobStatusEnum, automationStepEnum, emailDeliveryEnum, emailStatusEnum, entityTypeEnum, jobStatusEnum, modelTierEnum, notificationTypeEnum } from "./enums";
import { contributors, organizations, users } from "./identity";
import { editions } from "./editions";

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key"),
    status: jobStatusEnum("status").notNull().default("QUEUED"),
    priority: integer("priority").notNull().default(5),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown> | null>(),
    progress: jsonb("progress").$type<{ done: number; total: number; message?: string } | null>(),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("jobs_idempotency_key_idx").on(t.idempotencyKey), index("jobs_status_run_at_idx").on(t.status, t.runAt), index("jobs_edition_idx").on(t.editionId)],
);

export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    step: automationStepEnum("step").notNull(),
    runKey: text("run_key").notNull(), // `${editionId}:${step}` (or with a suffix for repeatable steps)
    status: text("status").notNull().default("PENDING"), // PENDING | RUNNING | SUCCEEDED | FAILED | SKIPPED
    triggeredBy: text("triggered_by").notNull().default("SCHEDULER"), // SCHEDULER | MANUAL
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("automation_runs_run_key_idx").on(t.runKey), index("automation_runs_edition_idx").on(t.editionId)],
);

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    version: integer("version").notNull().default(1),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull().default("general"),
    systemPrompt: text("system_prompt").notNull(),
    userPrompt: text("user_prompt").notNull(),
    outputSchemaName: text("output_schema_name"),
    modelTier: modelTierEnum("model_tier").notNull().default("FAST"),
    temperature: real("temperature").notNull().default(0.2),
    maxOutputTokens: integer("max_output_tokens").notNull().default(2000),
    isActive: boolean("is_active").notNull().default(true),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("prompt_templates_key_version_idx").on(t.key, t.version), index("prompt_templates_key_idx").on(t.key)],
);

export const aiJobs = pgTable(
  "ai_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    service: text("service").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptTemplateId: uuid("prompt_template_id").references(() => promptTemplates.id, { onDelete: "set null" }),
    promptKey: text("prompt_key"),
    promptVersion: integer("prompt_version"),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type"),
    entityId: uuid("entity_id"),
    status: aiJobStatusEnum("status").notNull().default("QUEUED"),
    inputRefs: jsonb("input_refs").$type<Record<string, unknown>>().notNull().default({}),
    inputHash: text("input_hash"),
    output: jsonb("output").$type<unknown>(),
    confidence: real("confidence"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costCents: numeric("cost_cents", { precision: 12, scale: 4 }),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    cached: boolean("cached").notNull().default(false),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    /** Who asked: the person in the request, or the one who queued the job that made the call. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("ai_jobs_edition_idx").on(t.editionId),
    index("ai_jobs_entity_idx").on(t.entityType, t.entityId),
    index("ai_jobs_input_hash_idx").on(t.service, t.inputHash),
    index("ai_jobs_user_idx").on(t.userId, t.createdAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    entityType: entityTypeEnum("entity_type"),
    entityId: uuid("entity_id"),
    href: text("href"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt)],
);

export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    to: text("to").notNull(),
    cc: text("cc"),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    textBody: text("text_body"),
    template: text("template"),
    status: emailStatusEnum("status").notNull().default("QUEUED"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    entityType: entityTypeEnum("entity_type"),
    entityId: uuid("entity_id"),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "set null" }),
    contributorId: uuid("contributor_id").references(() => contributors.id, { onDelete: "set null" }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** The address it went out as: the customer's own domain, or Briefly's while theirs is not ready. */
    fromAddress: text("from_address"),
    /** What the world did with it, from the provider's webhooks. */
    delivery: emailDeliveryEnum("delivery").notNull().default("PENDING"),
    deliveryDetail: text("delivery_detail"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    bouncedAt: timestamp("bounced_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    opens: integer("opens").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("email_log_edition_idx").on(t.editionId), index("email_log_contributor_idx").on(t.contributorId), index("email_log_provider_message_idx").on(t.providerMessageId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
    actorType: actorTypeEnum("actor_type").notNull().default("USER"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: entityTypeEnum("entity_type"),
    entityId: uuid("entity_id"),
    editionId: uuid("edition_id").references(() => editions.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entityType, t.entityId), index("audit_log_edition_idx").on(t.editionId), index("audit_log_created_idx").on(t.createdAt)],
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  description: text("description"),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
