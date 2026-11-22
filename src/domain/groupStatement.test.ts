import { describe, expect, it } from "vitest";
import {
  buildGroupStatementData,
  buildGroupSummaryText,
  GroupStatementError,
  groupStatementFingerprint,
  isGroupStatementStale,
  splitGroupCandidates,
  type GroupStatementMemberInput
} from "./groupStatement";
import type { StatementBuildEvent } from "./statementBuilder";
import type { SettlementGroupInput } from "./settlementUnits";

const event: StatementBuildEvent = {
  title: "سفر نمونه",
  currency: "تومان",
  treasurerPersonId: "t",
  treasurerCardNumberGrouped: "6037 0000 0000 0000",
  treasurerBankName: "بانک نمونه",
  treasurerAccountHolder: "ترانه نمونه"
};

function person(personId: string, balance: number, extra: Partial<GroupStatementMemberInput> = {}): GroupStatementMemberInput {
  return { personId, name: `نام-${personId}`, firstName: `اسم-${personId}`, balance, active: true, ...extra };
}

/** t is the treasurer (+50 so everything sums to zero): a +400, b −450, c 0. */
const base: GroupStatementMemberInput[] = [person("t", 50), person("a", 400), person("b", -450), person("c", 0)];
const family: SettlementGroupInput = { id: "g1", name: "خانواده", memberIds: ["a", "b"], representativeId: "b" };

describe("buildGroupStatementData", () => {
  it("2-person group: +400 and −450 give −50, 400 cancelled; the representative pays the treasurer", () => {
    const d = buildGroupStatementData({ event, members: base, groups: [family], groupId: "g1" });
    expect(d.kind).toBe("group");
    expect(d.group).toMatchObject({ groupId: "g1", name: "خانواده", representativeId: "b", representativeName: "نام-b" });
    expect(d.members.map((m) => [m.personId, m.balance])).toEqual([
      ["a", 400],
      ["b", -450]
    ]);
    expect(d.groupBalance).toBe(-50);
    expect(d.internalCancelled).toBe(400);
    expect(d.outcome).toBe("pay");
    expect(d.amount).toBe(50);
    expect(d.treasurerInGroup).toBe(false);
    expect(d.closingText).toBe("نمایندهٔ گروه (نام-b) باید مبلغ ۵۰ تومان به مسئول صندوق (نام-t) پرداخت کند.");
    expect(d.treasurerCardNumberGrouped).toBe("6037 0000 0000 0000");
  });

  it("creditor group: the representative receives from the treasurer", () => {
    const members = [person("t", -150), person("a", 100), person("b", 50), person("c", 0)];
    const d = buildGroupStatementData({ event, members, groups: [{ ...family, representativeId: "a" }], groupId: "g1" });
    expect(d.outcome).toBe("receive");
    expect(d.internalCancelled).toBe(0);
    expect(d.closingText).toBe("نمایندهٔ گروه (نام-a) باید مبلغ ۱۵۰ تومان از مسئول صندوق (نام-t) دریافت کند.");
  });

  it("10-person group: exact integer sum and cancelled amount", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
    const balances = [1200, -300, 450, -75, 0, 910, -1000, 33, -17, -5];
    const members = [person("t", -(balances.reduce((s, n) => s + n, 0))), ...ids.map((id, i) => person(id, balances[i]))];
    const g: SettlementGroupInput = { id: "big", name: "بزرگ", memberIds: ids, representativeId: "m3" };
    const d = buildGroupStatementData({ event, members, groups: [g], groupId: "big" });
    const credit = 1200 + 450 + 910 + 33;
    const debt = 300 + 75 + 1000 + 17 + 5;
    expect(d.members).toHaveLength(10);
    expect(d.groupBalance).toBe(credit - debt);
    expect(d.internalCancelled).toBe(Math.min(credit, debt));
    expect(d.outcome).toBe("receive");
  });

  it("zero-sum group is settled", () => {
    const members = [person("t", 0), person("a", 300), person("b", -300), person("c", 0)];
    const d = buildGroupStatementData({ event, members, groups: [family], groupId: "g1" });
    expect(d.outcome).toBe("settled");
    expect(d.amount).toBe(0);
    expect(d.internalCancelled).toBe(300);
    expect(d.closingText).toContain("تسویه‌شده");
  });

  it("treasurer inside the group: the group is the hub, the rest is settled outside the app", () => {
    const g: SettlementGroupInput = { id: "g1", name: "خانواده", memberIds: ["t", "b"], representativeId: "t" };
    const d = buildGroupStatementData({ event, members: base, groups: [g], groupId: "g1" });
    expect(d.treasurerInGroup).toBe(true);
    expect(d.groupBalance).toBe(-400);
    expect(d.outcome).toBe("pay");
    expect(d.closingText).toContain("مسئول صندوق (نام-t) عضو این گروه است");
    expect(d.closingText).toContain("بیرون از برنامه");
    expect(d.closingText).not.toContain("پرداخت کند");
  });

  it("archived member is included in the sum and marked inactive", () => {
    const members = [person("t", 50), person("a", 400), person("b", -450, { active: false }), person("c", 0)];
    const d = buildGroupStatementData({ event, members, groups: [family], groupId: "g1" });
    expect(d.groupBalance).toBe(-50);
    expect(d.members.find((m) => m.personId === "b")?.active).toBe(false);
  });

  it("refuses invalid groups (with the reasons) and unknown group ids", () => {
    const bad: SettlementGroupInput = { id: "g2", name: "تنها", memberIds: ["c"], representativeId: "c" };
    const err = (() => {
      try {
        buildGroupStatementData({ event, members: base, groups: [family, bad], groupId: "g2" });
      } catch (e) {
        return e as GroupStatementError;
      }
    })();
    expect(err).toBeInstanceOf(GroupStatementError);
    expect(err!.codes).toEqual(["too-few-members"]);
    expect(() => buildGroupStatementData({ event, members: base, groups: [family], groupId: "nope" })).toThrow(GroupStatementError);
    expect(() => buildGroupStatementData({ event: { ...event, treasurerPersonId: null }, members: base, groups: [family], groupId: "g1" })).toThrow(GroupStatementError);
  });

  it("one invalid group does not block a valid one", () => {
    const bad: SettlementGroupInput = { id: "g2", name: "تنها", memberIds: ["c"], representativeId: "c" };
    const d = buildGroupStatementData({ event, members: base, groups: [bad, family], groupId: "g1" });
    expect(d.groupBalance).toBe(-50);
  });

  it("is deterministic with shuffled input", () => {
    const g: SettlementGroupInput = { id: "g1", name: "خانواده", memberIds: ["b", "c", "a"], representativeId: "b" };
    const a = buildGroupStatementData({ event, members: base, groups: [g, { id: "g9", name: "دیگر", memberIds: ["t", "x"], representativeId: "t" }], groupId: "g1" });
    const shuffled = [...base].reverse();
    const b = buildGroupStatementData({
      event,
      members: shuffled,
      groups: [{ id: "g9", name: "دیگر", memberIds: ["x", "t"], representativeId: "t" }, { ...g, memberIds: ["c", "a", "b"] }],
      groupId: "g1"
    });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("splitGroupCandidates", () => {
  const ctx = { knownPersonIds: ["t", "a", "b", "c"], treasurerId: "t" };
  it("separates valid and invalid groups with reasons, in a fixed order", () => {
    const g2: SettlementGroupInput = { id: "g2", name: "ب", memberIds: ["b", "c"], representativeId: "c" }; // b is also in g1
    const split = splitGroupCandidates([g2, family], ctx);
    expect(split.valid).toEqual([]);
    expect(split.invalid.map((i) => [i.group.id, i.reasons])).toEqual([
      ["g1", ["person-in-multiple-groups"]],
      ["g2", ["person-in-multiple-groups"]]
    ]);
    const ok = splitGroupCandidates([{ id: "g3", name: "", memberIds: ["c", "t"], representativeId: "c" }, family], ctx);
    expect(ok.valid.map((g) => g.id)).toEqual(["g1"]);
    expect(ok.invalid[0].reasons).toEqual(["empty-name", "treasurer-must-represent"]);
  });
});

describe("stale detection (fingerprint)", () => {
  const issued = buildGroupStatementData({ event, members: base, groups: [family], groupId: "g1" });
  const rebuild = (over: { members?: GroupStatementMemberInput[]; group?: Partial<SettlementGroupInput>; event?: Partial<StatementBuildEvent> }) =>
    buildGroupStatementData({ event: { ...event, ...over.event }, members: over.members ?? base, groups: [{ ...family, ...over.group }], groupId: "g1" });

  it("unchanged data is not stale; names of people and unrelated balances do not matter", () => {
    expect(isGroupStatementStale(issued, rebuild({}))).toBe(false);
    expect(isGroupStatementStale(issued, rebuild({ members: base.map((m) => (m.personId === "c" ? { ...m, balance: 999 } : m)) }))).toBe(false);
    expect(isGroupStatementStale(issued, rebuild({ members: base.map((m) => ({ ...m, name: "تغییر" })) }))).toBe(false);
  });

  it("a member balance, membership, representative, name or treasurer change makes it stale", () => {
    expect(isGroupStatementStale(issued, rebuild({ members: base.map((m) => (m.personId === "a" ? { ...m, balance: 401 } : m)) }))).toBe(true);
    expect(isGroupStatementStale(issued, rebuild({ group: { memberIds: ["a", "b", "c"] } }))).toBe(true);
    expect(isGroupStatementStale(issued, rebuild({ group: { representativeId: "a" } }))).toBe(true);
    expect(isGroupStatementStale(issued, rebuild({ group: { name: "نام جدید" } }))).toBe(true);
    expect(isGroupStatementStale(issued, rebuild({ event: { treasurerPersonId: "c" } }))).toBe(true);
  });

  it("a group that no longer exists or is invalid is stale", () => {
    expect(isGroupStatementStale(issued, null)).toBe(true);
    expect(groupStatementFingerprint(issued)).toBe(groupStatementFingerprint({ ...issued }));
  });
});

describe("buildGroupSummaryText", () => {
  it("greets the representative; a paying group gets the treasurer's card", () => {
    const d = buildGroupStatementData({ event, members: base, groups: [family], groupId: "g1" });
    const text = buildGroupSummaryText({ data: d, link: "https://x/#/s/abc", noLinkLine: "بدون لینک" });
    expect(text).toContain("سلام اسم-b،");
    expect(text).toContain("صورت‌حساب گروه «خانواده»");
    expect(text).toContain("مسئول صندوق: نام-t");
    expect(text).toContain("شماره کارت: 6037 0000 0000 0000");
    expect(text.endsWith("https://x/#/s/abc")).toBe(true);
  });
  it("a receiving group gets no card and the fallback line without a link", () => {
    const members = [person("t", -150), person("a", 100), person("b", 50), person("c", 0)];
    const d = buildGroupStatementData({ event, members, groups: [family], groupId: "g1" });
    const text = buildGroupSummaryText({ data: d, link: null, noLinkLine: "بدون لینک" });
    expect(text).not.toContain("شماره کارت");
    expect(text.endsWith("بدون لینک")).toBe(true);
  });
});
