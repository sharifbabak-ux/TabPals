import { describe, expect, it } from "vitest";
import { computeHubSettlement } from "./hubSettlement";
import {
  buildUnits,
  computeUnitSettlement,
  controlSumMatches,
  repairGroupAfterMemberRemoval,
  unitsToHubInput,
  validateGroups,
  type GroupUnit,
  type SettlementGroupInput
} from "./settlementUnits";

const known = ["a", "b", "c", "d", "e", "t"];
const ctx = { knownPersonIds: known, treasurerId: "t" };
const g = (id: string, memberIds: string[], representativeId = memberIds[0], name = `گروه ${id}`): SettlementGroupInput => ({ id, name, memberIds, representativeId });
const codes = (groups: SettlementGroupInput[], c = ctx) => validateGroups(groups, c).map((e) => e.code);

describe("validateGroups", () => {
  it("accepts a valid set", () => {
    expect(validateGroups([g("g1", ["a", "b"]), g("g2", ["c", "d"])], ctx)).toEqual([]);
  });
  it("rejects a person in two groups", () => {
    const errs = validateGroups([g("g2", ["a", "c"]), g("g1", ["a", "b"])], ctx);
    expect(errs).toEqual([{ code: "person-in-multiple-groups", groupId: "g1", personId: "a", groupIds: ["g1", "g2"] }]);
  });
  it("rejects a group with fewer than 2 members", () => {
    expect(codes([g("g1", ["a"])])).toEqual(["too-few-members"]);
  });
  it("rejects duplicate member ids", () => {
    expect(codes([g("g1", ["a", "a", "b"])])).toEqual(["duplicate-member"]);
  });
  it("rejects an unknown person id", () => {
    expect(validateGroups([g("g1", ["a", "zzz"])], ctx)).toEqual([{ code: "unknown-person", groupId: "g1", personId: "zzz" }]);
  });
  it("rejects a representative who is not a member", () => {
    expect(codes([g("g1", ["a", "b"], "c")])).toEqual(["representative-not-member"]);
  });
  it("rejects an empty name", () => {
    expect(codes([g("g1", ["a", "b"], "a", "   ")])).toEqual(["empty-name"]);
  });
  it("requires the treasurer to be the representative of their group", () => {
    expect(codes([g("g1", ["t", "a"], "a")])).toEqual(["treasurer-must-represent"]);
    expect(codes([g("g1", ["t", "a"], "t")])).toEqual([]);
  });
  it("gives the same errors for shuffled input", () => {
    const x = [g("g2", ["a", "zzz"]), g("g1", ["a"], "q", "")];
    expect(validateGroups([...x].reverse(), ctx)).toEqual(validateGroups(x, ctx));
  });
});

describe("buildUnits", () => {
  it("sums a mixed-sign 2-person group (+400 and -450 gives -50) and tracks internal cancel", () => {
    const units = buildUnits({ a: 400, b: -450, c: 50 }, [g("g1", ["a", "b"])]);
    const grp = units.find((u) => u.kind === "group") as GroupUnit;
    expect(grp.balance).toBe(-50);
    expect(grp.internalCancelled).toBe(400);
    expect(grp.settled).toBe(false);
    expect(grp.members).toEqual([
      { personId: "a", balance: 400 },
      { personId: "b", balance: -450 }
    ]);
  });
  it("handles a 10-member group", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `m${String(i).padStart(2, "0")}`);
    const bal: Record<string, number> = {};
    ids.forEach((id, i) => (bal[id] = (i - 4) * 100)); // -400..500, sum 500
    const grp = buildUnits(bal, [g("big", ids)])[0] as GroupUnit;
    expect(grp.members).toHaveLength(10);
    expect(grp.balance).toBe(500);
    expect(grp.internalCancelled).toBe(1000);
  });
  it("marks a net-zero group as settled", () => {
    const grp = buildUnits({ a: 300, b: -300 }, [g("g1", ["a", "b"])])[0] as GroupUnit;
    expect(grp.settled).toBe(true);
    expect(grp.balance).toBe(0);
    expect(grp.internalCancelled).toBe(300);
  });
  it("keeps the balance of an archived/removed member (absent from the active list) in the group sum", () => {
    // "e" is archived: still a key in balances and a member of the group.
    const grp = buildUnits({ a: 100, e: 25, c: -125 }, [g("g1", ["a", "e"])])[0] as GroupUnit;
    expect(grp.balance).toBe(125);
  });
  it("turns ungrouped persons into single units, sorted by key", () => {
    const units = buildUnits({ c: 1, a: -1, b: 0 }, [g("g1", ["d", "e"])]);
    expect(units.map((u) => u.key)).toEqual(["g:g1", "p:a", "p:b", "p:c"]);
  });
  it("control sum: unit balances equal person balances", () => {
    const bal = { a: 400, b: -450, c: 70, d: -20, t: 0 };
    const units = buildUnits(bal, [g("g1", ["a", "b"]), g("g2", ["c", "d"])]);
    expect(controlSumMatches(bal, units)).toBe(true);
    expect(units.reduce((s, u) => s + u.balance, 0)).toBe(0);
    expect(controlSumMatches({ ...bal, a: 401 }, units)).toBe(false);
  });
  it("rejects non-integer balances", () => {
    expect(() => buildUnits({ a: 1.5 }, [])).toThrow(RangeError);
  });
  it("is identical for shuffled persons and groups", () => {
    const groups = [g("g1", ["a", "b"]), g("g2", ["c", "d", "e"])];
    const bal = { a: 10, b: -30, c: 5, d: 5, e: -5, t: 15 };
    const shuffledBal = { t: 15, e: -5, d: 5, c: 5, b: -30, a: 10 };
    const shuffledGroups = [g("g2", ["e", "c", "d"], "c"), g("g1", ["b", "a"], "a")];
    expect(buildUnits(shuffledBal, shuffledGroups)).toEqual(buildUnits(bal, groups));
  });
});

describe("hub adapter", () => {
  it("with NO groups equals computeHubSettlement exactly (balances in id order)", () => {
    const list = [
      { personId: "a", balance: -300 },
      { personId: "b", balance: 120 },
      { personId: "c", balance: 0 },
      { personId: "d", balance: 230 },
      { personId: "e", balance: -100 },
      { personId: "t", balance: 50 }
    ];
    const rec = Object.fromEntries(list.map((x) => [x.personId, x.balance]));
    expect(computeUnitSettlement(rec, [], ctx)).toEqual(computeHubSettlement(list, "t"));
    expect(unitsToHubInput(buildUnits(rec, []))).toEqual(list);
  });
  it("routes group money through the representative", () => {
    const bal = { a: 100, b: -300, c: 200, t: 0 };
    const plan = computeUnitSettlement(bal, [g("g1", ["a", "b"], "b")], ctx);
    // group g1 = -200 via representative b; c is paid by t.
    expect(plan.transfers).toEqual([
      { fromPersonId: "b", toPersonId: "t", amount: 200 },
      { fromPersonId: "t", toPersonId: "c", amount: 200 }
    ]);
    expect(plan.totalCollected - plan.totalPaidOut).toBe(0);
  });
  it("treasurer inside a group: the group is the hub unit and creates no transfer for itself", () => {
    const bal = { t: 100, a: -40, b: -160, c: 100 };
    const plan = computeUnitSettlement(bal, [g("g1", ["t", "a"], "t")], ctx);
    // group balance = 60 (hub, skipped); b pays t 160; t pays c 100.
    expect(plan.transfers).toEqual([
      { fromPersonId: "b", toPersonId: "t", amount: 160 },
      { fromPersonId: "t", toPersonId: "c", amount: 100 }
    ]);
    expect(plan.totalCollected - plan.totalPaidOut).toBe(60);
  });
  it("refuses a treasurer in a group represented by someone else", () => {
    expect(() => computeUnitSettlement({ t: 1, a: -1 }, [g("g1", ["t", "a"], "a")], ctx)).toThrow();
  });
});

describe("repairGroupAfterMemberRemoval", () => {
  it("keeps the representative when another member leaves", () => {
    const r = repairGroupAfterMemberRemoval(g("g1", ["a", "b", "c"], "a"), "c");
    expect(r.group).toEqual(g("g1", ["a", "b"], "a"));
    expect(r.notice).toBeNull();
  });
  it("falls back to the first remaining member, with a notice", () => {
    const r = repairGroupAfterMemberRemoval(g("g1", ["a", "b", "c"], "b"), "b");
    expect(r.group).toEqual(g("g1", ["a", "c"], "a"));
    expect(r.notice).toBe("representative-fallback");
    expect(r.message).toBeTruthy();
  });
  it("dissolves when fewer than 2 members remain", () => {
    const r = repairGroupAfterMemberRemoval(g("g1", ["a", "b"], "a"), "b");
    expect(r.group).toBeNull();
    expect(r.notice).toBe("dissolved");
  });
  it("ignores a person who is not in the group", () => {
    const grp = g("g1", ["a", "b"]);
    expect(repairGroupAfterMemberRemoval(grp, "zzz")).toEqual({ group: grp, notice: null, message: null });
  });
});
