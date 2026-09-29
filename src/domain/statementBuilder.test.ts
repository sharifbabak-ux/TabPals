import { describe, expect, it } from "vitest";
import { buildComprehensiveReportData, buildMemberStatementData, type StatementBuildEvent, type StatementBuildMember, type StatementBuildVoucher } from "./statementBuilder";

const event: StatementBuildEvent = {
  title: "سفر شمال",
  startDate: "2025-01-01",
  endDate: "2025-01-05",
  currency: "تومان",
  treasurerPersonId: "t"
};

const members: StatementBuildMember[] = [
  { personId: "t", name: "ترانه", defaultWeight: 1 },
  { personId: "a", name: "آرش", defaultWeight: 1 },
  { personId: "b", name: "بهار", defaultWeight: 1 }
];

const vouchers: StatementBuildVoucher[] = [
  {
    number: 1,
    type: "expense",
    expenseDate: "2025-01-01",
    recordedAt: "2025-01-01T10:00:00.000Z",
    description: "شام",
    totalAmount: 3000,
    payers: [{ personId: "t", amount: 3000 }],
    participants: [
      { personId: "t", weight: 1 },
      { personId: "a", weight: 1 },
      { personId: "b", weight: 1 }
    ],
    shares: [
      { personId: "t", share: 1000 },
      { personId: "a", share: 1000 },
      { personId: "b", share: 1000 }
    ],
    splitMode: "equal"
  },
  {
    number: 2,
    type: "expense",
    expenseDate: "2025-01-02",
    recordedAt: "2025-01-02T10:00:00.000Z",
    description: "تاکسی",
    totalAmount: 900,
    payers: [{ personId: "a", amount: 900 }],
    participants: [
      { personId: "a", weight: 2 },
      { personId: "b", weight: 1 }
    ],
    shares: [
      { personId: "a", share: 600 },
      { personId: "b", share: 300 }
    ],
    splitMode: "weight"
  },
  {
    number: 3,
    type: "contribution",
    expenseDate: "2025-01-01",
    recordedAt: "2025-01-01T09:00:00.000Z",
    description: "واریز اولیه",
    totalAmount: 500,
    payers: [],
    participants: [],
    shares: [],
    fromPersonId: "a",
    toPersonId: "t"
  },
  {
    number: 4,
    type: "settlement",
    expenseDate: "2025-01-03",
    recordedAt: "2025-01-03T09:00:00.000Z",
    description: "تسویه بین دوستان",
    totalAmount: 200,
    payers: [],
    participants: [],
    shares: [],
    fromPersonId: "b",
    toPersonId: "a"
  }
];

describe("buildMemberStatementData — member kind", () => {
  const data = buildMemberStatementData({ kind: "member", event, members, vouchers, personId: "a" });

  it("includes every expense the member participated in or paid for, ordered by date", () => {
    expect(data.expenses.map((e) => e.voucherNumber)).toEqual([1, 2]);
  });

  it("computes per-row share/paid/split explanation correctly", () => {
    const [row1, row2] = data.expenses;
    expect(row1).toMatchObject({ share: 1000, paid: 0, splitExplanation: "مساوی بین ۳ نفر (۳٬۰۰۰ ÷ ۳)" });
    expect(row2).toMatchObject({ share: 600, paid: 900, splitExplanation: "ضریب ۲ از مجموع ۳" });
    expect(row1.participantNames).toEqual(["ترانه", "آرش", "بهار"]);
  });

  it("totals the expense rows", () => {
    expect(data.expenseTotals).toEqual({ totalAmount: 3900, totalShare: 1600, totalPaid: 900 });
  });

  it("lists fund/settlement entries with counterparties, sorted by date", () => {
    expect(data.fundEntries).toEqual([
      { kind: "contribution", voucherNumber: 3, date: "2025-01-01", description: "واریز اولیه", amount: 500, counterpartyName: "ترانه" },
      { kind: "settlementReceived", voucherNumber: 4, date: "2025-01-03", description: "تسویه بین دوستان", amount: 200, counterpartyName: "بهار" }
    ]);
  });

  it("matches the balance-breakdown summary and has no hub settlement", () => {
    expect(data.summary.balance).toBe(-400);
    expect(data.hubSettlement).toBeNull();
  });
});

describe("buildMemberStatementData — treasurer kind", () => {
  const data = buildMemberStatementData({ kind: "treasurer", event, members, vouchers, personId: "t" });

  it("only includes expenses the treasurer participated in or paid for", () => {
    expect(data.expenses.map((e) => e.voucherNumber)).toEqual([1]);
  });

  it("includes contributions received as treasurer", () => {
    expect(data.fundEntries).toEqual([
      { kind: "receivedAsTreasurer", voucherNumber: 3, date: "2025-01-01", description: "واریز اولیه", amount: 500, counterpartyName: "آرش" }
    ]);
  });

  it("builds the treasurer-hub settlement section satisfying the collected-paidOut invariant", () => {
    expect(data.hubSettlement).not.toBeNull();
    const hub = data.hubSettlement!;
    expect(hub.paysToTreasurer).toEqual(
      expect.arrayContaining([
        { personId: "a", name: "آرش", amount: 400 },
        { personId: "b", name: "بهار", amount: 1100 }
      ])
    );
    expect(hub.paysFromTreasurer).toEqual([]);
    expect(hub.totalCollected - hub.totalPaidOut).toBe(data.summary.balance);
  });
});

describe("buildComprehensiveReportData", () => {
  const report = buildComprehensiveReportData({ event, members, vouchers });

  it("lists members in given order with the treasurer badge", () => {
    expect(report.members.map((m) => m.personId)).toEqual(["t", "a", "b"]);
    expect(report.members.find((m) => m.personId === "t")?.isTreasurer).toBe(true);
    expect(report.members.find((m) => m.personId === "a")?.isTreasurer).toBe(false);
  });

  it("builds a full ledger ordered by voucher number with payers/participants/split mode", () => {
    expect(report.ledger.map((row) => row.number)).toEqual([1, 2, 3, 4]);
    expect(report.ledger[0]).toMatchObject({
      type: "expense",
      splitMode: "equal",
      payers: [{ name: "ترانه", amount: 3000 }],
      participantShares: [
        { name: "ترانه", share: 1000 },
        { name: "آرش", share: 1000 },
        { name: "بهار", share: 1000 }
      ]
    });
    expect(report.ledger[3]).toMatchObject({ type: "settlement", fromName: "بهار", toName: "آرش" });
  });

  it("builds the fund account: contributions in, treasurer expense payments, remaining", () => {
    expect(report.fundAccount.contributions).toEqual([{ voucherNumber: 3, name: "آرش", date: "2025-01-01", amount: 500 }]);
    expect(report.fundAccount.totalContributed).toBe(500);
    expect(report.fundAccount.treasurerExpensePayments).toEqual([{ voucherNumber: 1, description: "شام", amount: 3000 }]);
    expect(report.fundAccount.totalPaidByTreasurer).toBe(3000);
    expect(report.fundAccount.remaining).toBe(500 - 3000);
  });

  it("builds a per-member summary row that sums balances to zero", () => {
    expect(report.memberSummaries).toHaveLength(3);
    const total = report.memberSummaries.reduce((sum, m) => sum + m.balance, 0);
    expect(total).toBe(0);
  });

  it("passes both control checks on consistent data", () => {
    expect(report.controlChecks).toEqual([
      { label: "جمع سهم‌ها = جمع هزینه‌ها", passed: true },
      { label: "جمع مانده‌ها = ۰", passed: true }
    ]);
  });

  it("builds the same hub settlement plan as the treasurer statement", () => {
    expect(report.hubSettlement?.totalCollected).toBe(1500);
    expect(report.hubSettlement?.totalPaidOut).toBe(0);
  });
});
