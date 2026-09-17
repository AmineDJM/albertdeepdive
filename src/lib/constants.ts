export const STORY_TYPES = [
  { value: "BUSINESS_DEEP_DIVE", label: "Business Deep Dive", short: "BDD", description: "A company case project: the case, the data, the methods, the winners." },
  { value: "STUDENT_ACHIEVEMENT", label: "Student achievement", short: "Achievement", description: "Admissions, awards, competitions, results." },
  { value: "STUDENT_PROJECT", label: "Student startup / project", short: "Startup", description: "A company, product or project launched by students." },
  { value: "INTERVIEW_PROFILE", label: "Interview / profile", short: "Profile", description: "A conversation with or portrait of a student, alumnus or staff member." },
  { value: "SCHOOL_NEWS", label: "School news", short: "Albert Actus", description: "Institutional news: partnerships, accreditations, press, programmes." },
  { value: "ASSOCIATION", label: "Association / club", short: "Association", description: "Life and initiatives of student associations." },
  { value: "CAMPUS_LIFE", label: "Campus life", short: "Campus", description: "Daily life, anecdotes, campus rivalries, little victories." },
  { value: "EVENT_RECAP", label: "Event recap", short: "Recap", description: "What happened at an event that already took place." },
  { value: "UPCOMING_EVENT", label: "Upcoming event", short: "Upcoming", description: "Something to announce: date, place, how to sign up." },
  { value: "ALUMNI", label: "Alumni", short: "Alumni", description: "News from graduates." },
  { value: "ACADEMIC_NEWS", label: "Academic news", short: "Academic", description: "Courses, assessments, faculty, pedagogy." },
  { value: "CAREER_INTERNSHIP", label: "Career / internship", short: "Careers", description: "Internships, jobs, corporate relations." },
  { value: "DATA_AI_BUSINESS_INSIGHT", label: "Data / AI / business insight", short: "Insight", description: "External news or analysis relevant to Albert students, with sources." },
  { value: "PHOTO_STORY", label: "Photo story", short: "Photos", description: "A story told mostly through pictures." },
  { value: "ANECDOTE", label: "Anecdote", short: "Anecdote", description: "A short, fun, true story." },
  { value: "OTHER", label: "Other", short: "Other", description: "Anything else worth telling." },
] as const;

export type StoryTypeValue = (typeof STORY_TYPES)[number]["value"];

export function storyTypeLabel(value: string) {
  return STORY_TYPES.find((t) => t.value === value)?.label ?? value;
}

export function storyTypeShort(value: string) {
  return STORY_TYPES.find((t) => t.value === value)?.short ?? value;
}

/** Default editorial sections, inferred from the reference issue. Fully configurable per edition. */
export const DEFAULT_SECTIONS = [
  { slug: "cover", name: "Cover", kicker: null, colour: "#10203A", targetPages: 1, storyTypes: [] as string[] },
  { slug: "this-month", name: "This Month", kicker: "Contents & editorial", colour: "#10203A", targetPages: 1, storyTypes: [] as string[] },
  { slug: "spotlight", name: "Spotlight", kicker: "People discover", colour: "#2BAFE0", targetPages: 3, storyTypes: ["INTERVIEW_PROFILE", "STUDENT_ACHIEVEMENT"] },
  { slug: "projects", name: "Student Projects & Startups", kicker: "Student initiative", colour: "#F2994A", targetPages: 2, storyTypes: ["STUDENT_PROJECT"] },
  { slug: "bdd", name: "Business Deep Dives", kicker: "Business Deep Dive", colour: "#10203A", targetPages: 6, storyTypes: ["BUSINESS_DEEP_DIVE"] },
  { slug: "actus", name: "Albert Actus", kicker: "School news", colour: "#1F6FB2", targetPages: 3, storyTypes: ["SCHOOL_NEWS", "ACADEMIC_NEWS", "CAREER_INTERNSHIP"] },
  { slug: "data-business", name: "Business & Data", kicker: "Under pressure", colour: "#5B5FCF", targetPages: 1, storyTypes: ["DATA_AI_BUSINESS_INSIGHT"] },
  { slug: "campus-life", name: "Campus Life", kicker: "Anecdotes & student life", colour: "#E4572E", targetPages: 3, storyTypes: ["CAMPUS_LIFE", "ANECDOTE", "EVENT_RECAP", "PHOTO_STORY"] },
  { slug: "associations", name: "Associations", kicker: "Association", colour: "#2A9D8F", targetPages: 2, storyTypes: ["ASSOCIATION"] },
  { slug: "events", name: "Events & Upcoming", kicker: "Save the date", colour: "#C9A227", targetPages: 1, storyTypes: ["UPCOMING_EVENT"] },
  { slug: "alumni-careers", name: "Alumni & Careers", kicker: "Careers", colour: "#6B7280", targetPages: 1, storyTypes: ["ALUMNI"] },
  { slug: "back-page", name: "Back Page", kicker: "Community", colour: "#10203A", targetPages: 1, storyTypes: ["OTHER"] },
] as const;

export function defaultSectionForStoryType(storyType: string): string {
  const found = DEFAULT_SECTIONS.find((s) => (s.storyTypes as readonly string[]).includes(storyType));
  return found?.slug ?? "campus-life";
}

export const PAGE_TEMPLATES = [
  { code: "COVER_A", name: "Cover — photo-led", family: "cover", capacityWords: 80, imageSlots: 1, description: "Full-bleed lead photo, masthead, lead headline, teaser strip." },
  { code: "COVER_B", name: "Cover — headline-led", family: "cover", capacityWords: 120, imageSlots: 3, description: "Masthead, typographic lead headline, three teaser images." },
  { code: "CONTENTS", name: "Contents & editorial", family: "front", capacityWords: 220, imageSlots: 1, description: "Table of contents generated from the flatplan, editorial letter." },
  { code: "SECTION_OPENER", name: "Section opener", family: "front", capacityWords: 60, imageSlots: 1, description: "Large section title with a full-page photo." },
  { code: "ARTICLE_HERO", name: "Article — hero", family: "article", capacityWords: 520, imageSlots: 1, description: "Large image, headline, standfirst, two columns of text." },
  { code: "ARTICLE_TWO_COLUMN", name: "Article — two columns", family: "article", capacityWords: 720, imageSlots: 1, description: "Headline, standfirst, two text columns, one inline image." },
  { code: "ARTICLE_THREE_COLUMN", name: "Article — three columns", family: "article", capacityWords: 900, imageSlots: 1, description: "Dense three-column article for long reads." },
  { code: "INTERVIEW", name: "Interview", family: "article", capacityWords: 780, imageSlots: 1, description: "Portrait, Q&A rhythm with capitalised questions, fact box." },
  { code: "PROFILE", name: "Profile", family: "article", capacityWords: 650, imageSlots: 2, description: "Portrait-led feature with crossheads and a pull quote." },
  { code: "BDD_CASE", name: "BDD — case", family: "bdd", capacityWords: 560, imageSlots: 2, description: "Company logo, cohort label, structured case blocks, winning team." },
  { code: "BDD_VISUAL", name: "BDD — visual", family: "bdd", capacityWords: 320, imageSlots: 3, description: "Dashboard screenshots and diagrams with captions." },
  { code: "PHOTO_STORY", name: "Photo story", family: "visual", capacityWords: 160, imageSlots: 4, description: "Image grid with captions and a short text." },
  { code: "NEWS_GRID", name: "News grid", family: "news", capacityWords: 640, imageSlots: 2, description: "Two to four short news items on one page." },
  { code: "SHORTS", name: "Shorts", family: "news", capacityWords: 560, imageSlots: 0, description: "Anecdotes and one-liners with oversized labels." },
  { code: "EVENT", name: "Event", family: "news", capacityWords: 260, imageSlots: 1, description: "Announcement: why / with whom / where and when." },
  { code: "QUOTE_PAGE", name: "Quote page", family: "visual", capacityWords: 60, imageSlots: 1, description: "A single pull quote over a full-page photo." },
  { code: "BACK_PAGE", name: "Back page", family: "back", capacityWords: 260, imageSlots: 2, description: "Community: puzzle, roles wanted, next events, colophon." },
] as const;

export type PageTemplateCode = (typeof PAGE_TEMPLATES)[number]["code"];

export function templateByCode(code: string) {
  return PAGE_TEMPLATES.find((t) => t.code === code) ?? PAGE_TEMPLATES[5];
}

export const CONSENT_TEXT_VERSION = "2026-09";
export const CONSENT_TEXTS = {
  PUBLICATION: "I confirm that this information may be published in Albert Deep Dive (print and digital) and that the people named have agreed to be mentioned.",
  IMAGE_RIGHTS: "I confirm that I have the right to share these photographs and that the people pictured agree to appear in Albert Deep Dive.",
} as const;

export const RIGHTS_STATUS_LABELS = {
  GREEN: "Approved",
  YELLOW: "Unclear",
  RED: "Do not publish",
} as const;

export const TARGET_LENGTHS = [
  { value: "SHORT", label: "Short", words: [120, 260] },
  { value: "MEDIUM", label: "Medium", words: [260, 520] },
  { value: "LONG", label: "Long", words: [520, 850] },
  { value: "FEATURE", label: "Feature", words: [850, 1400] },
] as const;

export const CONTRIBUTOR_TYPES = ["STUDENT", "CAMPUS_AMBASSADOR", "ASSOCIATION", "CLASS_REPRESENTATIVE", "ADMINISTRATION", "FACULTY", "CORPORATE_RELATIONS", "BDD_REPRESENTATIVE", "ALUMNI", "STUDENT_ENTREPRENEUR", "STAFF", "OTHER"] as const;
export type ContributorType = (typeof CONTRIBUTOR_TYPES)[number];

/** Audience directory segments — who the finished magazine is sent to. Mirrors `audienceSegmentEnum`. */
export const AUDIENCE_SEGMENTS = ["STUDENT", "PARENT", "PARTNER", "ADMINISTRATION", "ALUMNI", "STAFF", "OTHER"] as const;
export type AudienceSegment = (typeof AUDIENCE_SEGMENTS)[number];
