import { describe, expect, it } from "vitest";
import { csvCell, csvName, toCsv } from "@/lib/csv";
import { guessSubscriberMapping, mapAndValidateSubscribers } from "@/server/subscribers/manage";

/**
 * Taking a list out, and bringing one in.
 *
 * Both directions have one failure mode that matters and is invisible in a code review: a file
 * that opens wrong. A comma in a name that splits a row, an accent that comes out as mojibake, a
 * name beginning with "=" that a spreadsheet runs as a formula — and, coming the other way, a
 * column guessed wrong that silently imports four hundred surnames as addresses.
 */
describe("a list as a file", () => {
  it("quotes what has to be quoted and leaves the rest alone", () => {
    expect(csvCell("Dupont")).toBe("Dupont");
    expect(csvCell("Dupont, Marie")).toBe('"Dupont, Marie"');
    expect(csvCell('She said "yes"')).toBe('"She said ""yes"""');
    expect(csvCell("line\r\nbreak")).toBe('"line\r\nbreak"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });

  it("does not hand a spreadsheet a formula to run", () => {
    // A name field is not a place to run one, and "=1+1" is a real thing people are called on
    // exactly one day a year and a real thing an attacker writes every other day.
    expect(csvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(csvCell("+33 6 12 34 56 78")).toBe("'+33 6 12 34 56 78");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@here")).toBe("'@here");
  });

  it("starts with the mark that makes Excel read it as UTF-8", () => {
    const csv = toCsv([{ name: "Amélie Müller" }], [{ header: "Name", value: (row) => row.name }]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("Amélie Müller");
    expect(csv.split("\r\n")[0]).toBe("﻿Name");
  });

  it("names the file for what it is and when it was taken", () => {
    expect(csvName("subscribers", new Date("2026-09-20T10:00:00Z"))).toBe("subscribers-2026-09-20.csv");
  });
});

describe("a spreadsheet of readers", () => {
  it("guesses the columns in either language", () => {
    expect(guessSubscriberMapping(["Prénom", "Nom", "Adresse e-mail", "Langue"])).toMatchObject({ mode: "separate", firstName: 0, lastName: 1, email: 2, locale: 3 });
    expect(guessSubscriberMapping(["Email", "Full name"])).toMatchObject({ mode: "fullName", email: 0, fullName: 1 });
  });

  it("says what it will do with every row, before doing any of it", () => {
    const mapping = guessSubscriberMapping(["Email", "Prénom", "Nom"]);
    const result = mapAndValidateSubscribers({
      rows: [
        ["marie@example.fr", "Marie", "Dupont"],
        ["MARIE@example.fr", "Marie", "Dupont"],
        ["pas-une-adresse", "Jean", "Martin"],
        ["already@example.fr", "Léa", "Bernard"],
        ["gone@example.fr", "Paul", "Petit"],
      ],
      mapping,
      existing: [
        { email: "already@example.fr", status: "SUBSCRIBED" },
        { email: "gone@example.fr", status: "UNSUBSCRIBED" },
      ],
      options: { updateExisting: true, resubscribe: false },
    });

    expect(result.rows.map((row) => row.status)).toEqual(["create", "skip", "skip", "update", "skip"]);
    // The line numbers are the ones the spreadsheet shows, header included.
    expect(result.rows.map((row) => row.line)).toEqual([2, 3, 4, 5, 6]);
    expect(result.summary).toMatchObject({ total: 5, toCreate: 1, toUpdate: 1, toSkip: 3, invalid: 1, duplicates: 1 });
    // Somebody who left is left alone unless that is asked for in as many words.
    expect(result.rows[4].notes.join(" ")).toContain("Unsubscribed");
  });

  it("splits one name column into two, and reads the language", () => {
    const result = mapAndValidateSubscribers({
      rows: [["Marie Dupont", "marie@example.fr", "Français"]],
      mapping: { mode: "fullName", fullName: 0, email: 1, locale: 2, firstName: null, lastName: null },
      existing: [],
      options: { updateExisting: true, resubscribe: false },
    });
    expect(result.rows[0]).toMatchObject({ firstName: "Marie", lastName: "Dupont", locale: "fr", status: "create" });
  });

  it("brings somebody back only when asked", () => {
    const rows = [["gone@example.fr", "Paul", "Petit"]];
    const mapping = guessSubscriberMapping(["Email", "Prénom", "Nom"]);
    const existing = [{ email: "gone@example.fr", status: "UNSUBSCRIBED" }];
    expect(mapAndValidateSubscribers({ rows, mapping, existing, options: { updateExisting: true, resubscribe: true } }).rows[0].status).toBe("update");
    expect(mapAndValidateSubscribers({ rows, mapping, existing, options: { updateExisting: true, resubscribe: false } }).rows[0].status).toBe("skip");
  });
});
