import { describe, expect, it } from "vitest";
import {
  buildImportCandidates,
  selectAllCandidates,
  selectNoCandidates,
  toggleCandidateSelection,
  type ImportCandidate
} from "./memberImport";

const SOURCE_MEMBERS: ImportCandidate[] = [
  { personId: "p1", name: "Ali" },
  { personId: "p2", name: "Sara" },
  { personId: "p3", name: "Reza" }
];

describe("buildImportCandidates", () => {
  it("returns all source members when the current event has none of them", () => {
    expect(buildImportCandidates(SOURCE_MEMBERS, [])).toEqual(SOURCE_MEMBERS);
  });

  it("skips source members already present in the current event", () => {
    const result = buildImportCandidates(SOURCE_MEMBERS, ["p2"]);
    expect(result).toEqual([
      { personId: "p1", name: "Ali" },
      { personId: "p3", name: "Reza" }
    ]);
  });

  it("returns an empty list when every source member is already present", () => {
    expect(buildImportCandidates(SOURCE_MEMBERS, ["p1", "p2", "p3"])).toEqual([]);
  });
});

describe("selectAllCandidates / selectNoCandidates", () => {
  it("selects every candidate's personId", () => {
    const selected = selectAllCandidates(SOURCE_MEMBERS);
    expect(selected).toEqual(new Set(["p1", "p2", "p3"]));
  });

  it("clears the selection", () => {
    expect(selectNoCandidates()).toEqual(new Set());
  });
});

describe("toggleCandidateSelection", () => {
  it("adds a person id that isn't selected yet", () => {
    const result = toggleCandidateSelection(new Set(["p1"]), "p2");
    expect(result).toEqual(new Set(["p1", "p2"]));
  });

  it("removes a person id that is already selected", () => {
    const result = toggleCandidateSelection(new Set(["p1", "p2"]), "p1");
    expect(result).toEqual(new Set(["p2"]));
  });

  it("does not mutate the original set", () => {
    const original = new Set(["p1"]);
    toggleCandidateSelection(original, "p2");
    expect(original).toEqual(new Set(["p1"]));
  });
});
