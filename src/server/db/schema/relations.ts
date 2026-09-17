import { relations } from "drizzle-orm";
import { academicPrograms, campuses, contributorGroupMembers, contributorGroups, contributors, organizationMembers, organizations, publications, sessions, users } from "./identity";
import { audienceRecipients } from "./audience";
import { editionSections, editions, submissionCampaigns, submissionRequests } from "./editions";
import { consentRecords, mediaAssets, mediaVariants, submissionAttachments, submissionCampuses, submissions } from "./submissions";
import { articleRevisions, articleSources, articles, businessDeepDives, editorialComments, events, facts, informationRequests, organisations, people, quotes, stories, storyCampuses, storyClusterMembers, storyClusters, storyMedia, storyOrganisations, storyPeople } from "./newsroom";
import { pagePlanPages, pagePlans, publicationAssets, publicationVersions } from "./publication";
import { aiJobs, jobs, notifications } from "./platform";
import { editionOutputs, publicationSubscriptions, subscribers } from "./outputs";

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  createdBy: one(users, { relationName: "organizationCreator", fields: [organizations.createdById], references: [users.id] }),
  members: many(organizationMembers),
  publications: many(publications),
  campuses: many(campuses),
  programs: many(academicPrograms),
  contributors: many(contributors),
  contributorGroups: many(contributorGroups),
  editions: many(editions),
}));

// `userId` and `invitedById` both point at `users`, so each side needs a name to pair up with.
export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, { fields: [organizationMembers.organizationId], references: [organizations.id] }),
  user: one(users, { relationName: "organizationMembership", fields: [organizationMembers.userId], references: [users.id] }),
  invitedBy: one(users, { relationName: "organizationInviter", fields: [organizationMembers.invitedById], references: [users.id] }),
}));

export const publicationsRelations = relations(publications, ({ one, many }) => ({
  organization: one(organizations, { fields: [publications.organizationId], references: [organizations.id] }),
  createdBy: one(users, { relationName: "publicationCreator", fields: [publications.createdById], references: [users.id] }),
  editions: many(editions),
  subscriptions: many(publicationSubscriptions),
}));

export const editionOutputsRelations = relations(editionOutputs, ({ one }) => ({
  edition: one(editions, { fields: [editionOutputs.editionId], references: [editions.id] }),
  organization: one(organizations, { fields: [editionOutputs.organizationId], references: [organizations.id] }),
  version: one(publicationVersions, { fields: [editionOutputs.versionId], references: [publicationVersions.id] }),
}));

export const subscribersRelations = relations(subscribers, ({ one, many }) => ({
  organization: one(organizations, { fields: [subscribers.organizationId], references: [organizations.id] }),
  subscriptions: many(publicationSubscriptions),
}));

export const publicationSubscriptionsRelations = relations(publicationSubscriptions, ({ one }) => ({
  publication: one(publications, { fields: [publicationSubscriptions.publicationId], references: [publications.id] }),
  subscriber: one(subscribers, { fields: [publicationSubscriptions.subscriberId], references: [subscribers.id] }),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  campus: one(campuses, { fields: [users.campusId], references: [campuses.id] }),
  sessions: many(sessions),
  notifications: many(notifications),
  memberships: many(organizationMembers, { relationName: "organizationMembership" }),
  invitedMemberships: many(organizationMembers, { relationName: "organizationInviter" }),
  createdOrganizations: many(organizations, { relationName: "organizationCreator" }),
  createdPublications: many(publications, { relationName: "publicationCreator" }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const campusesRelations = relations(campuses, ({ one, many }) => ({
  organization: one(organizations, { fields: [campuses.organizationId], references: [organizations.id] }),
  contributors: many(contributors),
}));

export const academicProgramsRelations = relations(academicPrograms, ({ one, many }) => ({
  organization: one(organizations, { fields: [academicPrograms.organizationId], references: [organizations.id] }),
  contributors: many(contributors),
}));

export const contributorsRelations = relations(contributors, ({ one, many }) => ({
  organization: one(organizations, { fields: [contributors.organizationId], references: [organizations.id] }),
  campus: one(campuses, { fields: [contributors.campusId], references: [campuses.id] }),
  program: one(academicPrograms, { fields: [contributors.programId], references: [academicPrograms.id] }),
  user: one(users, { fields: [contributors.userId], references: [users.id] }),
  groupMemberships: many(contributorGroupMembers),
  submissions: many(submissions),
  requests: many(submissionRequests),
}));

export const audienceRecipientsRelations = relations(audienceRecipients, ({ one }) => ({
  campus: one(campuses, { fields: [audienceRecipients.campusId], references: [campuses.id] }),
}));

export const contributorGroupsRelations = relations(contributorGroups, ({ many, one }) => ({
  organization: one(organizations, { fields: [contributorGroups.organizationId], references: [organizations.id] }),
  members: many(contributorGroupMembers),
  campus: one(campuses, { fields: [contributorGroups.campusId], references: [campuses.id] }),
}));

export const contributorGroupMembersRelations = relations(contributorGroupMembers, ({ one }) => ({
  group: one(contributorGroups, { fields: [contributorGroupMembers.groupId], references: [contributorGroups.id] }),
  contributor: one(contributors, { fields: [contributorGroupMembers.contributorId], references: [contributors.id] }),
}));

export const editionsRelations = relations(editions, ({ many, one }) => ({
  organization: one(organizations, { fields: [editions.organizationId], references: [organizations.id] }),
  publication: one(publications, { fields: [editions.publicationId], references: [publications.id] }),
  sections: many(editionSections),
  campaigns: many(submissionCampaigns),
  submissions: many(submissions),
  clusters: many(storyClusters),
  stories: many(stories),
  articles: many(articles),
  mediaAssets: many(mediaAssets),
  pagePlans: many(pagePlans),
  versions: many(publicationVersions),
  outputs: many(editionOutputs),
  editorInChief: one(users, { fields: [editions.editorInChiefId], references: [users.id] }),
}));

export const editionSectionsRelations = relations(editionSections, ({ one, many }) => ({
  edition: one(editions, { fields: [editionSections.editionId], references: [editions.id] }),
  stories: many(stories),
}));

export const submissionCampaignsRelations = relations(submissionCampaigns, ({ one, many }) => ({
  edition: one(editions, { fields: [submissionCampaigns.editionId], references: [editions.id] }),
  requests: many(submissionRequests),
}));

export const submissionRequestsRelations = relations(submissionRequests, ({ one, many }) => ({
  campaign: one(submissionCampaigns, { fields: [submissionRequests.campaignId], references: [submissionCampaigns.id] }),
  contributor: one(contributors, { fields: [submissionRequests.contributorId], references: [contributors.id] }),
  campus: one(campuses, { fields: [submissionRequests.campusId], references: [campuses.id] }),
  submissions: many(submissions),
}));

export const submissionsRelations = relations(submissions, ({ one, many }) => ({
  edition: one(editions, { fields: [submissions.editionId], references: [editions.id] }),
  campaign: one(submissionCampaigns, { fields: [submissions.campaignId], references: [submissionCampaigns.id] }),
  request: one(submissionRequests, { fields: [submissions.requestId], references: [submissionRequests.id] }),
  contributor: one(contributors, { fields: [submissions.contributorId], references: [contributors.id] }),
  campuses: many(submissionCampuses),
  attachments: many(submissionAttachments),
  mediaAssets: many(mediaAssets),
  clusterMemberships: many(storyClusterMembers),
  consents: many(consentRecords),
}));

export const submissionCampusesRelations = relations(submissionCampuses, ({ one }) => ({
  submission: one(submissions, { fields: [submissionCampuses.submissionId], references: [submissions.id] }),
  campus: one(campuses, { fields: [submissionCampuses.campusId], references: [campuses.id] }),
}));

export const submissionAttachmentsRelations = relations(submissionAttachments, ({ one }) => ({
  submission: one(submissions, { fields: [submissionAttachments.submissionId], references: [submissions.id] }),
  mediaAsset: one(mediaAssets, { fields: [submissionAttachments.mediaAssetId], references: [mediaAssets.id] }),
}));

export const mediaAssetsRelations = relations(mediaAssets, ({ one, many }) => ({
  edition: one(editions, { fields: [mediaAssets.editionId], references: [editions.id] }),
  submission: one(submissions, { fields: [mediaAssets.submissionId], references: [submissions.id] }),
  contributor: one(contributors, { fields: [mediaAssets.uploadedByContributorId], references: [contributors.id] }),
  variants: many(mediaVariants),
  storyLinks: many(storyMedia),
}));

export const mediaVariantsRelations = relations(mediaVariants, ({ one }) => ({
  asset: one(mediaAssets, { fields: [mediaVariants.assetId], references: [mediaAssets.id] }),
}));

export const storyClustersRelations = relations(storyClusters, ({ one, many }) => ({
  edition: one(editions, { fields: [storyClusters.editionId], references: [editions.id] }),
  members: many(storyClusterMembers),
  story: one(stories, { fields: [storyClusters.id], references: [stories.clusterId] }),
}));

export const storyClusterMembersRelations = relations(storyClusterMembers, ({ one }) => ({
  cluster: one(storyClusters, { fields: [storyClusterMembers.clusterId], references: [storyClusters.id] }),
  submission: one(submissions, { fields: [storyClusterMembers.submissionId], references: [submissions.id] }),
}));

export const storiesRelations = relations(stories, ({ one, many }) => ({
  edition: one(editions, { fields: [stories.editionId], references: [editions.id] }),
  cluster: one(storyClusters, { fields: [stories.clusterId], references: [storyClusters.id] }),
  section: one(editionSections, { fields: [stories.sectionId], references: [editionSections.id] }),
  article: one(articles, { fields: [stories.id], references: [articles.storyId] }),
  campuses: many(storyCampuses),
  media: many(storyMedia),
  facts: many(facts),
  quotes: many(quotes),
  people: many(storyPeople),
  organisations: many(storyOrganisations),
  events: many(events),
  bdd: one(businessDeepDives, { fields: [stories.id], references: [businessDeepDives.storyId] }),
  assignedTo: one(users, { fields: [stories.assignedToUserId], references: [users.id] }),
  informationRequests: many(informationRequests),
}));

export const storyCampusesRelations = relations(storyCampuses, ({ one }) => ({
  story: one(stories, { fields: [storyCampuses.storyId], references: [stories.id] }),
  campus: one(campuses, { fields: [storyCampuses.campusId], references: [campuses.id] }),
}));

export const storyMediaRelations = relations(storyMedia, ({ one }) => ({
  story: one(stories, { fields: [storyMedia.storyId], references: [stories.id] }),
  asset: one(mediaAssets, { fields: [storyMedia.mediaAssetId], references: [mediaAssets.id] }),
}));

export const articlesRelations = relations(articles, ({ one, many }) => ({
  story: one(stories, { fields: [articles.storyId], references: [stories.id] }),
  edition: one(editions, { fields: [articles.editionId], references: [editions.id] }),
  revisions: many(articleRevisions),
  sources: many(articleSources),
  author: one(users, { fields: [articles.authorUserId], references: [users.id] }),
}));

export const articleRevisionsRelations = relations(articleRevisions, ({ one }) => ({
  article: one(articles, { fields: [articleRevisions.articleId], references: [articles.id] }),
  createdBy: one(users, { fields: [articleRevisions.createdById], references: [users.id] }),
}));

export const articleSourcesRelations = relations(articleSources, ({ one }) => ({
  article: one(articles, { fields: [articleSources.articleId], references: [articles.id] }),
  submission: one(submissions, { fields: [articleSources.submissionId], references: [submissions.id] }),
}));

export const factsRelations = relations(facts, ({ one }) => ({
  story: one(stories, { fields: [facts.storyId], references: [stories.id] }),
  sourceSubmission: one(submissions, { fields: [facts.sourceSubmissionId], references: [submissions.id] }),
  verifiedBy: one(users, { fields: [facts.verifiedById], references: [users.id] }),
}));

export const quotesRelations = relations(quotes, ({ one }) => ({
  story: one(stories, { fields: [quotes.storyId], references: [stories.id] }),
  sourceSubmission: one(submissions, { fields: [quotes.sourceSubmissionId], references: [submissions.id] }),
}));

export const storyPeopleRelations = relations(storyPeople, ({ one }) => ({
  story: one(stories, { fields: [storyPeople.storyId], references: [stories.id] }),
  person: one(people, { fields: [storyPeople.personId], references: [people.id] }),
}));

export const peopleRelations = relations(people, ({ many, one }) => ({
  stories: many(storyPeople),
  campus: one(campuses, { fields: [people.campusId], references: [campuses.id] }),
}));

export const storyOrganisationsRelations = relations(storyOrganisations, ({ one }) => ({
  story: one(stories, { fields: [storyOrganisations.storyId], references: [stories.id] }),
  organisation: one(organisations, { fields: [storyOrganisations.organisationId], references: [organisations.id] }),
}));

export const organisationsRelations = relations(organisations, ({ many, one }) => ({
  stories: many(storyOrganisations),
  logo: one(mediaAssets, { fields: [organisations.logoAssetId], references: [mediaAssets.id] }),
}));

export const eventsRelations = relations(events, ({ one }) => ({
  story: one(stories, { fields: [events.storyId], references: [stories.id] }),
  campus: one(campuses, { fields: [events.campusId], references: [campuses.id] }),
}));

export const businessDeepDivesRelations = relations(businessDeepDives, ({ one }) => ({
  story: one(stories, { fields: [businessDeepDives.storyId], references: [stories.id] }),
  organisation: one(organisations, { fields: [businessDeepDives.organisationId], references: [organisations.id] }),
  campus: one(campuses, { fields: [businessDeepDives.campusId], references: [campuses.id] }),
  logo: one(mediaAssets, { fields: [businessDeepDives.logoAssetId], references: [mediaAssets.id] }),
  teamPhoto: one(mediaAssets, { fields: [businessDeepDives.teamPhotoAssetId], references: [mediaAssets.id] }),
}));

export const editorialCommentsRelations = relations(editorialComments, ({ one }) => ({
  user: one(users, { fields: [editorialComments.userId], references: [users.id] }),
}));

export const informationRequestsRelations = relations(informationRequests, ({ one }) => ({
  story: one(stories, { fields: [informationRequests.storyId], references: [stories.id] }),
  contributor: one(contributors, { fields: [informationRequests.contributorId], references: [contributors.id] }),
  requestedBy: one(users, { fields: [informationRequests.requestedById], references: [users.id] }),
}));

export const pagePlansRelations = relations(pagePlans, ({ one, many }) => ({
  edition: one(editions, { fields: [pagePlans.editionId], references: [editions.id] }),
  pages: many(pagePlanPages),
}));

export const pagePlanPagesRelations = relations(pagePlanPages, ({ one }) => ({
  plan: one(pagePlans, { fields: [pagePlanPages.planId], references: [pagePlans.id] }),
  section: one(editionSections, { fields: [pagePlanPages.sectionId], references: [editionSections.id] }),
  story: one(stories, { fields: [pagePlanPages.storyId], references: [stories.id] }),
  article: one(articles, { fields: [pagePlanPages.articleId], references: [articles.id] }),
}));

export const publicationVersionsRelations = relations(publicationVersions, ({ one, many }) => ({
  edition: one(editions, { fields: [publicationVersions.editionId], references: [editions.id] }),
  assets: many(publicationAssets),
  createdBy: one(users, { fields: [publicationVersions.createdById], references: [users.id] }),
}));

export const publicationAssetsRelations = relations(publicationAssets, ({ one }) => ({
  version: one(publicationVersions, { fields: [publicationAssets.versionId], references: [publicationVersions.id] }),
}));

export const jobsRelations = relations(jobs, ({ one }) => ({
  edition: one(editions, { fields: [jobs.editionId], references: [editions.id] }),
}));

export const aiJobsRelations = relations(aiJobs, ({ one }) => ({
  edition: one(editions, { fields: [aiJobs.editionId], references: [editions.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));
