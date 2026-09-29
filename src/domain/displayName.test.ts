import { describe, expect, it } from "vitest";
import { displayName, personFullName } from "./displayName";

describe("displayName", () => {
  it("returns just the first name when no one else in the event shares it", () => {
    const members = [
      { personId: "p1", firstName: "علی", lastName: "رضایی" },
      { personId: "p2", firstName: "رضا", lastName: "احمدی" }
    ];
    expect(displayName(members[0], members)).toBe("علی");
  });

  it("adds the last name in parentheses when another member has the same first name", () => {
    const members = [
      { personId: "p1", firstName: "علی", lastName: "رضایی" },
      { personId: "p2", firstName: "علی", lastName: "احمدی" }
    ];
    expect(displayName(members[0], members)).toBe("علی (رضایی)");
    expect(displayName(members[1], members)).toBe("علی (احمدی)");
  });

  it("disambiguates every one of three identical first names", () => {
    const members = [
      { personId: "p1", firstName: "علی", lastName: "الف" },
      { personId: "p2", firstName: "علی", lastName: "ب" },
      { personId: "p3", firstName: "علی", lastName: "ج" }
    ];
    for (const m of members) {
      expect(displayName(m, members)).toBe(`علی (${m.lastName})`);
    }
  });

  it("falls back to the bare first name when the duplicate person has no last name", () => {
    const members = [
      { personId: "p1", firstName: "علی", lastName: "" },
      { personId: "p2", firstName: "علی", lastName: "رضایی" }
    ];
    expect(displayName(members[0], members)).toBe("علی");
    expect(displayName(members[1], members)).toBe("علی (رضایی)");
  });

  it("normalizes before comparing (Arabic letters, digits, case)", () => {
    const members = [
      { personId: "p1", firstName: "علي", lastName: "الف" },
      { personId: "p2", firstName: "علی", lastName: "ب" }
    ];
    expect(displayName(members[0], members)).toBe("علي (الف)");
  });
});

describe("personFullName", () => {
  it("joins first and last name with a space", () => {
    expect(personFullName({ firstName: "علی", lastName: "رضایی" })).toBe("علی رضایی");
  });

  it("trims a trailing space when last name is empty", () => {
    expect(personFullName({ firstName: "علی", lastName: "" })).toBe("علی");
  });
});
