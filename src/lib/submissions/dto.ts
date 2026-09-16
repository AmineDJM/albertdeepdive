/** Wire types shared by the public contribution API and the form (no server imports). */
import type { StoryTypeValue } from "@/lib/constants";
import type { CampaignPhase } from "@/lib/campaigns/schedule";

export type RequestStatusValue = "PENDING" | "SENT" | "OPENED" | "SUBMITTED" | "DECLINED" | "EXPIRED" | "BOUNCED";

export type AttachmentKindValue = "IMAGE" | "DOCUMENT" | "AUDIO" | "VIDEO" | "OTHER";

export type AttachmentDTO = {
  id: string;
  kind: AttachmentKindValue;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  caption: string | null;
  photographer: string | null;
  /** Signed, short-lived URL of the thumbnail (images only). */
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
};

export type DraftDTO = {
  id: string;
  storyType: StoryTypeValue;
  title: string;
  campusIds: string[];
  eventDateText: string;
  description: string;
  peopleInvolved: string;
  organisationsInvolved: string;
  whyItMatters: string;
  quotes: string;
  urls: string[];
  contactName: string;
  contactEmail: string;
  extra: Record<string, unknown>;
  publicationConsent: boolean;
  imageRightsConfirmed: boolean;
  attachments: AttachmentDTO[];
  updatedAt: string;
};

export type CampusDTO = { id: string; name: string; slug: string; colour: string | null };

export type InvitationDTO = {
  requestId: string;
  status: RequestStatusValue;
  phase: CampaignPhase;
  canSubmit: boolean;
  /** Why the form is not available, when it is not. */
  blockedReason: "NOT_OPEN" | "CLOSED" | "EXPIRED" | "DECLINED" | null;
  contributor: { firstName: string; lastName: string; email: string; campusId: string | null; campusName: string | null };
  edition: { id: string; label: string; title: string; issueNumber: number };
  campaign: {
    id: string;
    name: string;
    introMessage: string | null;
    opensAt: string;
    deadlineAt: string;
    graceEndsAt: string;
    status: string;
  };
  campuses: CampusDTO[];
  /** Dates pre-formatted on the server (Paris time) so the client never formats during hydration. */
  labels: { opensLong: string; deadline: string; deadlineLong: string; graceEnds: string; graceEndsLong: string };
  submittedCount: number;
  contactEmail: string | null;
  consentTextVersion: string;
  draft: DraftDTO | null;
};

export type PublicApiError = { error: string; fieldErrors?: Record<string, string[]>; code?: string };
