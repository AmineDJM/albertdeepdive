import { describe, expect, it } from "vitest";
import {
  guessMapping,
  mapAndValidateRows,
  resolveContributorType,
  splitFullName,
  type CampusRef,
  type ColumnMapping,
  type ExistingContributor,
  type ImportOptions,
} from "@/server/contributors/import";

const CAMPUSES: CampusRef[] = [
  { id: "paris", name: "Paris", slug: "paris" },
  { id: "lyon", name: "Lyon", slug: "lyon" },
  { id: "eco", name: "École de Marseille", slug: "ecole-de-marseille" },
];

const OPTIONS: ImportOptions = { updateExisting: true, setActive: true };

function mapping(partial: Partial<ColumnMapping>): ColumnMapping {
  return { mode: "separate", firstName: null, lastName: null, fullName: null, email: null, campus: null, type: null, ...partial };
}

function validate(header: string[], rows: string[][], map: ColumnMapping, existing: ExistingContributor[] = [], options: ImportOptions = OPTIONS) {
  return mapAndValidateRows({ header, rows, mapping: map, campuses: CAMPUSES, existing, options });
}

describe("guessMapping", () => {
  it("auto-guesses French and English headers and does not confuse Prénom with Nom", () => {
    const guess = guessMapping(["Prénom", "Nom", "E-mail", "Campus", "Type"]);
    expect(guess).toEqual({ mode: "separate", firstName: 0, lastName: 1, email: 2, campus: 3, type: 4, fullName: null });
  });

  it("recognises alternative header spellings", () => {
    const guess = guessMapping(["Given name", "Surname", "Courriel", "Ville", "Role"]);
    expect(guess.firstName).toBe(0);
    expect(guess.lastName).toBe(1);
    expect(guess.email).toBe(2);
    expect(guess.campus).toBe(3);
    expect(guess.type).toBe(4);
    expect(guess.mode).toBe("separate");
  });

  it("falls back to full-name mode when there is a single name column", () => {
    const guess = guessMapping(["Full name", "Email"]);
    expect(guess.mode).toBe("fullName");
    expect(guess.fullName).toBe(0);
    expect(guess.email).toBe(1);
    expect(guess.firstName).toBeNull();
    expect(guess.lastName).toBeNull();
  });
});

describe("splitFullName", () => {
  it("splits on the last space so multi-word first names survive", () => {
    expect(splitFullName("Ada Lovelace")).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(splitFullName("Grace Brewster Murray Hopper")).toEqual({ firstName: "Grace Brewster Murray", lastName: "Hopper" });
    expect(splitFullName("  Marie   Curie  ")).toEqual({ firstName: "Marie", lastName: "Curie" });
  });

  it("leaves the last name empty when there is a single token", () => {
    expect(splitFullName("Madonna")).toEqual({ firstName: "Madonna", lastName: "" });
  });
});

describe("resolveContributorType", () => {
  it("maps enum keys and labels, defaulting to STUDENT", () => {
    expect(resolveContributorType("Faculty")).toBe("FACULTY");
    expect(resolveContributorType("campus ambassador")).toBe("CAMPUS_AMBASSADOR");
    expect(resolveContributorType("ALUMNI")).toBe("ALUMNI");
    expect(resolveContributorType("")).toBe("STUDENT");
    expect(resolveContributorType("something unknown")).toBe("STUDENT");
  });
});

describe("mapAndValidateRows", () => {
  const header = ["First", "Last", "Email", "Campus", "Type"];
  const map = mapping({ firstName: 0, lastName: 1, email: 2, campus: 3, type: 4 });

  it("trims and lower-cases the email and resolves the campus by name", () => {
    const res = validate(header, [["Ada", "Lovelace", "  ADA@Example.com ", "Paris", "Student"]], map);
    expect(res.rows[0].email).toBe("ada@example.com");
    expect(res.rows[0].status).toBe("create");
    expect(res.rows[0].campusId).toBe("paris");
    expect(res.rows[0].type).toBe("STUDENT");
    expect(res.summary.toCreate).toBe(1);
  });

  it("matches a campus accent-insensitively against name and slug", () => {
    const res = validate(
      header,
      [
        ["A", "One", "a@example.com", "lyon", ""], // slug
        ["B", "Two", "b@example.com", "École de Marseille", ""], // exact accented name
        ["C", "Three", "c@example.com", "ecole de marseille", ""], // accent-stripped
        ["D", "Four", "d@example.com", "Berlin", ""], // unknown → school-wide, soft note
        ["E", "Five", "e@example.com", "", ""], // blank → school-wide, no error
      ],
      map,
    );
    expect(res.rows[0].campusId).toBe("lyon");
    expect(res.rows[1].campusId).toBe("eco");
    expect(res.rows[2].campusId).toBe("eco");
    expect(res.rows[3].campusId).toBeNull();
    expect(res.rows[3].status).toBe("create"); // unknown campus is never a hard error
    expect(res.rows[3].badges.some((b) => b.label.includes("not found"))).toBe(true);
    expect(res.rows[4].campusId).toBeNull();
    expect(res.rows[4].badges).toHaveLength(0);
    expect(res.summary.campusUnresolved).toBe(1);
  });

  it("skips invalid and missing emails", () => {
    const res = validate(
      header,
      [
        ["Ada", "Lovelace", "not-an-email", "Paris", ""],
        ["Bob", "Stone", "", "Paris", ""],
        ["Cy", "Vance", "cy@example.com", "Paris", ""],
      ],
      map,
    );
    expect(res.rows[0].status).toBe("skip");
    expect(res.rows[0].badges[0].label).toBe("Invalid email");
    expect(res.rows[1].status).toBe("skip");
    expect(res.rows[1].badges[0].label).toBe("Missing email");
    expect(res.rows[2].status).toBe("create");
    expect(res.summary.invalid).toBe(2);
    expect(res.summary.toCreate).toBe(1);
  });

  it("keeps the first of an in-file duplicate and flags the rest", () => {
    const res = validate(
      header,
      [
        ["Ada", "Lovelace", "dup@example.com", "Paris", ""],
        ["Ada", "L.", " DUP@example.com ", "Lyon", ""],
        ["Ada", "L2", "dup@example.com", "", ""],
      ],
      map,
    );
    expect(res.rows[0].status).toBe("create");
    expect(res.rows[1].status).toBe("skip");
    expect(res.rows[1].badges[0].label).toContain("Duplicate in file");
    expect(res.rows[2].status).toBe("skip");
    expect(res.summary.duplicatesInFile).toBe(2);
    expect(res.summary.toCreate).toBe(1);
  });

  it("marks existing contributors for update, or skip when the switch is off", () => {
    const existing: ExistingContributor[] = [{ id: "x1", email: "ada@example.com" }];
    const rows = [["Ada", "Lovelace", "ADA@example.com", "Paris", ""]];
    const updated = validate(header, rows, map, existing, { updateExisting: true, setActive: true });
    expect(updated.rows[0].status).toBe("update");
    expect(updated.rows[0].existingId).toBe("x1");
    expect(updated.summary.toUpdate).toBe(1);

    const skipped = validate(header, rows, map, existing, { updateExisting: false, setActive: true });
    expect(skipped.rows[0].status).toBe("skip");
    expect(skipped.rows[0].badges[0].label).toContain("will skip");
    expect(skipped.summary.toSkip).toBe(1);
  });

  it("splits a single full-name column and flags names it cannot split", () => {
    const fnHeader = ["Name", "Email"];
    const fnMap = mapping({ mode: "fullName", fullName: 0, email: 1 });
    const res = validate(
      fnHeader,
      [
        ["Ada Lovelace", "ada@example.com"],
        ["Grace Brewster Murray Hopper", "grace@example.com"],
        ["Madonna", "madonna@example.com"],
      ],
      fnMap,
    );
    expect(res.rows[0]).toMatchObject({ firstName: "Ada", lastName: "Lovelace", status: "create" });
    expect(res.rows[1]).toMatchObject({ firstName: "Grace Brewster Murray", lastName: "Hopper", status: "create" });
    expect(res.rows[2].status).toBe("skip");
    expect(res.rows[2].badges[0].label).toBe("Could not split full name");
  });
});
