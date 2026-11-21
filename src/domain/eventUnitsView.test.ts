import { describe, expect, it } from "vitest";
import { computeHubSettlement } from "./hubSettlement";
import { buildEventUnitsView } from "./eventUnitsView";
import type { SettlementGroupInput } from "./settlementUnits";

const g = (id: string, memberIds: string[], representativeId = memberIds[0], name = `گروه ${id}`): SettlementGroupInput => ({ id, name, memberIds, representativeId });

describe("buildEventUnitsView", () => {
  it("no groups: identical to the individual hub plan, no group units", () => {
    const balances = { t: 100, a: -300, b: 200 };
    const v = buildEventUnitsView({ balancesByPerson: balances, groups: [], treasurerId: "t" });
    expect(v.valid).toBe(true);
    expect(v.hasGroups).toBe(false);
    expect(v.groupUnits).toEqual([]);
    expect(v.plan).toEqual(v.individualPlan);
    expect(v.plan).toEqual(computeHubSettlement([{ personId: "a", balance: -300 }, { personId: "b", balance: 200 }, { personId: "t", balance: 100 }], "t"));
    expect(v.sumOk).toBe(true);
  });

  it("2-person group (+400, −450): unit −50, 400 cancelled inside; transfer goes through the representative", () => {
    const balances = { t: 50, a: 400, b: -450 };
    const v = buildEventUnitsView({ balancesByPerson: balances, groups: [g("g1", ["a", "b"], "b")], treasurerId: "t" });
    expect(v.valid).toBe(true);
    const gu = v.groupUnits[0];
    expect(gu.balance).toBe(-50);
    expect(gu.internalCancelled).toBe(400);
    expect(gu.members).toEqual([{ personId: "a", balance: 400 }, { personId: "b", balance: -450 }]);
    expect(v.transfers).toEqual([{ unitKey: "g:g1", direction: "pay", fromPersonId: "b", toPersonId: "t", amount: 50 }]);
    // individual balances untouched
    expect(v.individualPlan.transfers.map((t) => [t.fromPersonId, t.toPersonId, t.amount])).toEqual([["t", "a", 400], ["b", "t", 450]]);
    expect(v.sumOk).toBe(true);
  });

  it("10-person group sums exactly", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
    const balances: Record<string, number> = { t: 0 };
    ids.forEach((id, i) => (balances[id] = i % 2 === 0 ? 100 * (i + 1) : -100 * i));
    balances.t = -ids.reduce((s, id) => s + balances[id], 0);
    const v = buildEventUnitsView({ balancesByPerson: balances, groups: [g("big", ids)], treasurerId: "t" });
    const gu = v.groupUnits[0];
    expect(gu.members).toHaveLength(10);
    expect(gu.balance).toBe(ids.reduce((s, id) => s + balances[id], 0));
    expect(v.sumOk).toBe(true);
  });

  it("zero-sum group is settled and produces no transfer", () => {
    const v = buildEventUnitsView({ balancesByPerson: { t: 0, a: 200, b: -200 }, groups: [g("g1", ["a", "b"])], treasurerId: "t" });
    expect(v.groupUnits[0].settled).toBe(true);
    expect(v.transfers).toEqual([]);
  });

  it("treasurer inside a group: that group is the hub unit and has no transfer", () => {
    const v = buildEventUnitsView({
      balancesByPerson: { t: 300, a: -100, c: -200 },
      groups: [g("g1", ["t", "a"], "t")],
      treasurerId: "t"
    });
    expect(v.valid).toBe(true);
    expect(v.treasurerInGroup).toBe(true);
    expect(v.hubUnit).toMatchObject({ kind: "group", key: "g:g1", balance: 200 });
    expect(v.transfers).toEqual([{ unitKey: "p:c", direction: "pay", fromPersonId: "c", toPersonId: "t", amount: 200 }]);
  });

  it("receive direction maps to the group unit via its representative", () => {
    const v = buildEventUnitsView({ balancesByPerson: { t: -500, a: 300, b: 200 }, groups: [g("g1", ["a", "b"], "b")], treasurerId: "t" });
    expect(v.transfers).toEqual([{ unitKey: "g:g1", direction: "receive", fromPersonId: "t", toPersonId: "b", amount: 500 }]);
  });

  it("invalid groups → fallback to individual results with reasons", () => {
    const v = buildEventUnitsView({ balancesByPerson: { t: 100, a: -50, b: -50 }, groups: [g("g1", ["a", "t"], "a")], treasurerId: "t" });
    expect(v.valid).toBe(false);
    expect(v.hasGroups).toBe(true);
    expect(v.reasons.map((r) => r.code)).toEqual(["treasurer-must-represent"]);
    expect(v.groupUnits).toEqual([]);
    expect(v.plan).toEqual(v.individualPlan);
    expect(v.units.every((u) => u.kind === "person")).toBe(true);
    expect(v.sumOk).toBe(true);
  });

  it("legacy group with an unknown member is invalid", () => {
    const v = buildEventUnitsView({ balancesByPerson: { t: 0, a: 0 }, groups: [g("g1", ["a", "ghost"])], treasurerId: "t" });
    expect(v.valid).toBe(false);
    expect(v.reasons[0].code).toBe("unknown-person");
  });

  it("no treasurer → invalid, nothing to settle", () => {
    const v = buildEventUnitsView({ balancesByPerson: { a: 10, b: -10 }, groups: [], treasurerId: null });
    expect(v.valid).toBe(false);
    expect(v.treasurerMissing).toBe(true);
    expect(v.transfers).toEqual([]);
  });

  it("shuffled input gives identical output", () => {
    const groups = [g("g2", ["c", "d"]), g("g1", ["a", "b"], "b")];
    const v1 = buildEventUnitsView({ balancesByPerson: { t: 10, a: 5, b: -30, c: 20, d: -5 }, groups, treasurerId: "t" });
    const v2 = buildEventUnitsView({
      balancesByPerson: { d: -5, c: 20, t: 10, b: -30, a: 5 },
      groups: [groups[1], groups[0]].map((x) => ({ ...x, memberIds: [...x.memberIds].reverse(), representativeId: x.representativeId })),
      treasurerId: "t"
    });
    expect(v2).toEqual(v1);
  });
});
