/** Typed seed content. Everything here is reconstructed from the May 2025 special issue. */
import type { ArticleBlock } from "@/lib/publication/document";

export type SeedMedia = {
  file: string; // file name in seed/media
  caption?: string;
  credit?: string;
  photographer?: string;
  kind?: "photo" | "logo" | "screenshot" | "diagram" | "chart" | "document";
  rights?: "GREEN" | "YELLOW" | "RED";
  role?: "hero" | "gallery" | "logo" | "diagram" | "screenshot" | "portrait";
};

export type SeedFact = {
  statement: string;
  category: "date" | "person" | "result" | "organisation" | "metric" | "award" | "other";
  confidence: "VERIFIED_BY_SUBMISSION" | "STATED_BY_CONTRIBUTOR" | "INFERRED" | "CONFLICTING";
  sourceIndex?: number; // index into story.submissions
  excerpt?: string;
  conflictGroup?: string;
  notes?: string;
};

export type SeedQuote = { text: string; speaker?: string; role?: string; sourceIndex?: number; pullQuote?: boolean };

export type SeedSubmission = {
  contributor: string; // contributor key
  storyType: string;
  title: string;
  campuses: string[]; // campus slugs, [] = school-wide
  description: string;
  peopleInvolved?: string;
  organisationsInvolved?: string;
  whyItMatters?: string;
  quotes?: string;
  urls?: string[];
  eventDateText?: string;
  extra?: Record<string, unknown>;
  media?: string[]; // file names from story.media
  status?: "NEW" | "NEEDS_REVIEW" | "MISSING_INFO" | "DUPLICATE" | "POTENTIAL_STORY" | "ACCEPTED" | "REJECTED";
  daysAfterOpen?: number;
};

export type SeedBdd = {
  companyName: string;
  programCode: string;
  campus: string;
  cohortLabel: string;
  dateText?: string;
  theCase?: string;
  theData?: string;
  theChallenge?: string;
  theApproach?: string;
  theMethods?: string;
  theSolution?: string;
  theResults?: string;
  keyTakeaways?: string[];
  winningTeam: { name: string; program?: string; campus?: string }[];
  finalists?: { name: string }[][];
  jury?: { name: string; role?: string; organisation?: string }[];
  technologies?: string[];
  metrics?: { label: string; value: string }[];
  logo?: string;
  teamPhoto?: string;
  dashboard?: string;
  diagram?: string;
};

export type SeedStory = {
  key: string;
  section: string; // section slug
  storyType: string;
  title: string; // working title
  campuses: string[];
  eventDateText?: string;
  status: "CANDIDATE" | "SELECTED" | "DRAFTING" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  articleStatus: "EMPTY" | "AI_DRAFT" | "IN_EDITING" | "READY_FOR_REVIEW" | "APPROVED";
  priority?: number;
  isCover?: boolean;
  isSpotlight?: boolean;
  kicker?: string;
  headline: string;
  standfirst?: string;
  byline?: string;
  targetLength?: "SHORT" | "MEDIUM" | "LONG" | "FEATURE";
  template?: string;
  body: ArticleBlock[];
  pullQuotes?: { text: string; attribution?: string }[];
  media: SeedMedia[];
  facts: SeedFact[];
  quotes?: SeedQuote[];
  people?: { name: string; role: "WINNER" | "FINALIST" | "JURY" | "INTERVIEWEE" | "AUTHOR" | "ORGANISER" | "FOUNDER" | "MENTIONED"; campus?: string; program?: string }[];
  organisations?: { name: string; type: "COMPANY" | "ASSOCIATION" | "SCHOOL" | "INSTITUTION" | "MEDIA" | "STARTUP" | "OTHER"; role: "PARTNER" | "SPONSOR" | "SUBJECT" | "MENTIONED" | "EMPLOYER" }[];
  bdd?: SeedBdd;
  event?: { title: string; dateText: string; location?: string; campus?: string; isUpcoming: boolean; signupUrl?: string; organiser?: string };
  submissions: SeedSubmission[];
  missingInformation?: { key: string; label: string; severity: "low" | "medium" | "high" }[];
  warnings?: { code: string; message: string; severity: "info" | "warning" | "error" }[];
  editorialNotes?: string;
  aiScores?: Record<string, number>;
};

let counter = 0;
export function b(): string {
  counter += 1;
  return `seed_b${counter.toString().padStart(4, "0")}`;
}
export const p = (text: string, sources?: string[]): ArticleBlock => ({ id: b(), type: "paragraph", text, sources });
export const h = (text: string): ArticleBlock => ({ id: b(), type: "crosshead", text });
export const q = (text: string, attribution?: string): ArticleBlock => ({ id: b(), type: "pullquote", text, attribution });
export const l = (items: string[], ordered = false): ArticleBlock => ({ id: b(), type: "list", items, ordered });
export const box = (title: string, items: string[]): ArticleBlock => ({ id: b(), type: "box", title, items });
export const qa = (question: string, answer: string): ArticleBlock => ({ id: b(), type: "qa", question, answer });
export const t = (text: string, speaker?: string): ArticleBlock => ({ id: b(), type: "testimony", text, speaker });
