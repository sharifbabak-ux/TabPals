import { describe, expect, it } from "vitest";
import { draftErrors, groupOfPerson, normalizeDraft, otherGroupOf, toggleDraftMember, treasurerIsLocked, type DraftContext } from "./settlementGroupForm";

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  knownPersonIds: ["t", "a", "b", "c", "d"],
  treasurerId: "t",
  groups: [],
  editingId: null,
  ...over
});

describe("settlementGroupForm", () => {
  it("reports every missing piece of an empty draft", () => {
    expect(draftErrors({ name: "", memberIds: [], representativeId: null }, ctx())).toEqual(["empty-name", "too-few-members", "no-representative"]);
  });

  it("is valid with a name, 2 members and a member representative", () => {
    expect(draftErrors({ name: "خانواده", memberIds: ["a", "b"], representativeId: "a" }, ctx())).toEqual([]);
  });

  it("asks for a representative when members are chosen but none is picked", () => {
    expect(draftErrors({ name: "x", memberIds: ["a", "b"], representativeId: null }, ctx())).toEqual(["no-representative"]);
  });

  it("flags a person who is already in another group, but ignores the group being edited", () => {
    const groups = [{ id: "g1", name: "الف", memberIds: ["a", "b"], representativeId: "a" }];
    expect(draftErrors({ name: "x", memberIds: ["b", "c"], representativeId: "b" }, ctx({ groups }))).toContain("person-in-multiple-groups");
    expect(draftErrors({ name: "x", memberIds: ["a", "b", "c"], representativeId: "a" }, ctx({ groups, editingId: "g1" }))).toEqual([]);
  });

  it("does not report problems of unrelated saved groups", () => {
    const groups = [{ id: "g1", name: "", memberIds: ["a"], representativeId: "a" }];
    expect(draftErrors({ name: "x", memberIds: ["b", "c"], representativeId: "b" }, ctx({ groups }))).toEqual([]);
  });

  it("forces and locks the treasurer as representative", () => {
    const d = { name: "x", memberIds: ["a"], representativeId: "a" };
    const toggled = toggleDraftMember(d, "t", "t");
    expect(toggled.representativeId).toBe("t");
    expect(treasurerIsLocked(toggled, "t")).toBe(true);
    expect(draftErrors({ ...toggled, representativeId: "a" }, ctx())).toContain("treasurer-must-represent");
    expect(normalizeDraft({ ...toggled, representativeId: "a" }, "t").representativeId).toBe("t");
  });

  it("clears the representative when he or she is unselected", () => {
    const d = toggleDraftMember({ name: "x", memberIds: ["a", "b"], representativeId: "a" }, "a", "t");
    expect(d).toEqual({ name: "x", memberIds: ["b"], representativeId: null });
  });

  it("finds a person's group", () => {
    const groups = [{ id: "g1", name: "الف", memberIds: ["a", "b"], representativeId: "a" }];
    expect(groupOfPerson(groups, "b")?.id).toBe("g1");
    expect(groupOfPerson(groups, "c")).toBeUndefined();
    expect(otherGroupOf(groups, "b", "g1")).toBeUndefined();
    expect(otherGroupOf(groups, "b", null)?.id).toBe("g1");
  });
});
