import { BDD_STORIES } from "./stories-bdd";
import { FEATURE_STORIES } from "./stories-features";
import { ACTUS_STORIES } from "./stories-actus";
import { CAMPUS_STORIES } from "./stories-campus";
import type { SeedStory } from "./types";

export const SEED_STORIES: SeedStory[] = [...FEATURE_STORIES, ...BDD_STORIES, ...ACTUS_STORIES, ...CAMPUS_STORIES];

export const SEED_CAMPUSES = [
  { slug: "paris", name: "Paris", city: "Paris", country: "France", colour: "#10203A", sortOrder: 1 },
  { slug: "lyon", name: "Lyon", city: "Lyon", country: "France", colour: "#1F6FB2", sortOrder: 2 },
  { slug: "marseille", name: "Marseille", city: "Marseille", country: "France", colour: "#2BAFE0", sortOrder: 3 },
  { slug: "geneva", name: "Geneva", city: "Geneva", country: "Switzerland", colour: "#C9A227", sortOrder: 4 },
];

export const SEED_PROGRAMS = [
  { code: "B1", name: "Bachelor 1", level: "Bachelor", sortOrder: 1 },
  { code: "B2", name: "Bachelor 2", level: "Bachelor", sortOrder: 2 },
  { code: "B3", name: "Bachelor 3", level: "Bachelor", sortOrder: 3 },
  { code: "IBBA", name: "International BBA", level: "Bachelor", sortOrder: 4 },
  { code: "MSC", name: "Master of Science", level: "Master", sortOrder: 5 },
  { code: "EXEC", name: "Executive education", level: "Executive", sortOrder: 6 },
];

/** Cover of the reference issue, kept verbatim as the working cover of the seed edition. */
export const SEED_COVER = {
  headline: "Carrefour, La Provence, LVMH... Behind the scenes of our famous Business Deep Dives over the last three months at Albert School",
  standfirst: "Also find all the latest news from the school, anecdotes and student life activities, as well as a summary of recent data or business related news.",
  media: "cover-portrait-student.jpg",
  teasers: [
    { story: "project-kaern", line: "Students found a digital consulting company" },
    { story: "actus-tribune-geneve", line: "Albert in La Tribune de Genève" },
    { story: "actus-albert-mind", line: "Albert Mind: your new ally for success" },
    { story: "campus-jonquille-run", line: "The Jonquille Run" },
    { story: "campus-spi-dauphine", line: "SPI Dauphine: one of the largest student sports events in France" },
    { story: "data-under-pressure", line: "AI from kindergarten: what the US executive order changes" },
    { story: "actus-executive-education", line: "School trains professionals? A seminar for 100 leaders of a CAC 40 group" },
    { story: "spotlight-ithier", line: "Ithier d'Aramon: how to get to X-HEC" },
    { story: "assoc-albertine", line: "New association: Albertine, promoting diversity" },
  ],
};

/** Flatplan of the seed edition (24 pages, A4). */
export const SEED_FLATPLAN: { template: string; section: string; stories?: string[]; media?: string[]; locked?: boolean }[] = [
  { template: "COVER_A", section: "cover", media: ["cover-portrait-student.jpg"], locked: true },
  { template: "CONTENTS", section: "this-month" },
  { template: "INTERVIEW", section: "spotlight", stories: ["spotlight-ithier"] },
  { template: "PROFILE", section: "spotlight", stories: ["spotlight-boris"] },
  { template: "ARTICLE_HERO", section: "projects", stories: ["project-kaern"] },
  { template: "BDD_CASE", section: "bdd", stories: ["bdd-carrefour-b2"] },
  { template: "BDD_VISUAL", section: "bdd", stories: ["bdd-carrefour-b2"] },
  { template: "BDD_CASE", section: "bdd", stories: ["bdd-carrefour-b1"] },
  { template: "BDD_CASE", section: "bdd", stories: ["bdd-gl-events"] },
  { template: "BDD_VISUAL", section: "bdd", stories: ["bdd-eramet"] },
  { template: "ARTICLE_TWO_COLUMN", section: "bdd", stories: ["bdd-prosol"] },
  { template: "BDD_CASE", section: "bdd", stories: ["bdd-volvo"] },
  { template: "ARTICLE_TWO_COLUMN", section: "bdd", stories: ["bdd-asmodee"] },
  { template: "BDD_CASE", section: "bdd", stories: ["bdd-la-provence"] },
  { template: "BDD_CASE", section: "bdd", stories: ["bdd-louis-vuitton"] },
  { template: "ARTICLE_TWO_COLUMN", section: "actus", stories: ["actus-executive-education"] },
  { template: "NEWS_GRID", section: "actus", stories: ["actus-cis", "actus-tribune-geneve", "actus-office-hours"] },
  { template: "ARTICLE_TWO_COLUMN", section: "actus", stories: ["actus-albert-mind"] },
  { template: "NEWS_GRID", section: "data-business", stories: ["data-under-pressure"] },
  { template: "SHORTS", section: "campus-life", stories: ["campus-prize-list"] },
  { template: "ARTICLE_HERO", section: "campus-life", stories: ["campus-spi-dauphine"] },
  { template: "NEWS_GRID", section: "campus-life", stories: ["campus-jonquille-run", "campus-table-football", "campus-marseille-maths"] },
  { template: "ARTICLE_TWO_COLUMN", section: "associations", stories: ["assoc-albertine"] },
  { template: "EVENT", section: "events", stories: ["event-admitted-party"] },
  { template: "BACK_PAGE", section: "back-page", stories: ["back-page-community"] },
];

export const SEED_CREDITS = [
  { role: "Editor in chief", name: "Milan Viallet" },
  { role: "Translator", name: "Khadidja Addi" },
];

export { SEED_CONTRIBUTORS, SEED_GROUPS } from "./contributors";
