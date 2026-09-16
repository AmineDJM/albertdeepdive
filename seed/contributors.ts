/**
 * Contributors: the editorial team named in the issue's bylines and colophon, plus the students whose
 * first-person testimonies appear in the paper. Emails use a non-deliverable demo domain.
 */
export type SeedContributor = {
  key: string;
  firstName: string;
  lastName: string;
  campus: string | null;
  program: string | null;
  type: "STUDENT" | "CAMPUS_AMBASSADOR" | "ASSOCIATION" | "CLASS_REPRESENTATIVE" | "ADMINISTRATION" | "FACULTY" | "CORPORATE_RELATIONS" | "BDD_REPRESENTATIVE" | "ALUMNI" | "STUDENT_ENTREPRENEUR" | "STAFF" | "OTHER";
  groups: string[];
  tags?: string[];
  organisationName?: string;
  language?: "en" | "fr";
};

export const SEED_CONTRIBUTORS: SeedContributor[] = [
  { key: "milan", firstName: "Milan", lastName: "Viallet", campus: "paris", program: "B2", type: "STUDENT", groups: ["editorial-team", "paris-ambassadors"], tags: ["editor-in-chief"] },
  { key: "khadidja", firstName: "Khadidja", lastName: "Addi", campus: "paris", program: "B2", type: "STUDENT", groups: ["editorial-team"], tags: ["translator"] },
  { key: "ines", firstName: "Ines", lastName: "Hocine", campus: "paris", program: "B1", type: "STUDENT", groups: ["editorial-team", "paris-ambassadors"] },
  { key: "colene", firstName: "Colène", lastName: "Geoffroy", campus: "lyon", program: "B1", type: "STUDENT", groups: ["editorial-team", "lyon-ambassadors", "bdd-representatives"] },
  { key: "maelle", firstName: "Maelle", lastName: "Lalanne Carillon", campus: "marseille", program: "B1", type: "STUDENT", groups: ["editorial-team", "marseille-ambassadors", "bdd-representatives"] },
  { key: "guillaume", firstName: "Guillaume", lastName: "Rabeau", campus: "paris", program: "B2", type: "STUDENT", groups: ["bdd-representatives"] },
  { key: "cynda", firstName: "Cynda", lastName: "Ben Abdessalem", campus: "paris", program: "B1", type: "STUDENT", groups: ["editorial-team"] },
  { key: "simon", firstName: "Simon", lastName: "Flasaquier", campus: "paris", program: "B1", type: "STUDENT", groups: ["editorial-team", "paris-ambassadors"], tags: ["photographer"] },
  { key: "sacha", firstName: "Sacha", lastName: "Nardoux", campus: "paris", program: "B2", type: "STUDENT", groups: ["bdd-representatives"] },
  { key: "alexis", firstName: "Alexis", lastName: "Meniante", campus: "marseille", program: "B1", type: "STUDENT_ENTREPRENEUR", groups: ["student-entrepreneurs", "marseille-ambassadors"], organisationName: "KÆRN" },
  { key: "lison", firstName: "Lison", lastName: "Szymkowicz", campus: "marseille", program: "B1", type: "ASSOCIATION", groups: ["associations"], organisationName: "Albertine" },
  { key: "joseph", firstName: "Joseph", lastName: "Abdo", campus: "paris", program: "B2", type: "ASSOCIATION", groups: ["associations"], organisationName: "Albert Crew" },
  { key: "othmane", firstName: "Othmane", lastName: "AitBoumlik", campus: "paris", program: null, type: "STAFF", groups: ["administration"], organisationName: "Albert Mind" },
  { key: "lucie-anna", firstName: "Lucie-Anna", lastName: "Oddon", campus: null, program: null, type: "CORPORATE_RELATIONS", groups: ["administration", "corporate-relations"] },
  { key: "boris", firstName: "Boris", lastName: "Bernard", campus: null, program: null, type: "ADMINISTRATION", groups: ["administration"], tags: ["digital-marketing"] },
  { key: "ithier", firstName: "Ithier", lastName: "d'Aramon", campus: "paris", program: "B3", type: "STUDENT", groups: ["paris-ambassadors"] },
  { key: "anna", firstName: "Anna", lastName: "Spira", campus: "paris", program: "B2", type: "STUDENT", groups: ["bdd-representatives"] },
  { key: "noah", firstName: "Noah", lastName: "Rossignol", campus: "lyon", program: "B1", type: "STUDENT", groups: ["lyon-ambassadors", "bdd-representatives"] },
  { key: "justine", firstName: "Justine", lastName: "Libourel", campus: "marseille", program: "B1", type: "STUDENT", groups: ["marseille-ambassadors", "bdd-representatives"] },
  { key: "kevin", firstName: "Kevin", lastName: "Lyon Administration", campus: "lyon", program: null, type: "ADMINISTRATION", groups: ["administration"], language: "fr" },
  { key: "eugenia", firstName: "Eugenia", lastName: "School Team", campus: null, program: null, type: "OTHER", groups: ["partners"], organisationName: "Eugenia School" },
];

export const SEED_GROUPS = [
  { slug: "editorial-team", name: "Albert's Deep Dive editorial team", description: "Students who write, translate and photograph the paper." },
  { slug: "paris-ambassadors", name: "Campus ambassadors — Paris", campus: "paris" },
  { slug: "lyon-ambassadors", name: "Campus ambassadors — Lyon", campus: "lyon" },
  { slug: "marseille-ambassadors", name: "Campus ambassadors — Marseille", campus: "marseille" },
  { slug: "geneva-ambassadors", name: "Campus ambassadors — Geneva", campus: "geneva" },
  { slug: "bdd-representatives", name: "Business Deep Dive representatives", description: "One student per BDD group, in charge of reporting the case." },
  { slug: "associations", name: "Associations & BDE" },
  { slug: "student-entrepreneurs", name: "Student entrepreneurs" },
  { slug: "administration", name: "Administration & staff" },
  { slug: "corporate-relations", name: "Corporate Relations" },
  { slug: "partners", name: "Partner schools" },
];
