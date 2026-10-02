import { describe, expect, it } from "vitest";
import { buildStatementLink, decodeStatementPayload, encodeStatementPayload, type StatementLinkPayload } from "./statementLink";
import type { MemberStatementData } from "./statementBuilder";

function baseMemberData(expenseCount: number): MemberStatementData & { closingText: string } {
  const expenses = Array.from({ length: expenseCount }, (_, i) => ({
    voucherNumber: i + 1,
    expenseDate: "2025-01-01",
    description: `هزینه شماره ${i + 1} با شرح نسبتاً طولانی برای افزایش حجم`,
    totalAmount: 1000,
    splitExplanation: "۵۰٪ برای هر نفر، سهم مساوی بین همه‌ی شرکت‌کنندگان این هزینه",
    share: 500,
    paid: 0,
    participantNames: ["آرش ای", "بهار بی", "ترانه تی", "دانیال دی"]
  }));

  return {
    kind: "member",
    event: { title: "سفر شمال", currency: "تومان" },
    member: { personId: "p1", name: "آرش", firstName: "آرش", lastName: "ای" },
    expenses,
    expenseTotals: { totalAmount: expenseCount * 1000, totalShare: expenseCount * 500, totalPaid: 0 },
    fundEntries: [],
    summary: {
      personId: "p1",
      expenseShare: expenseCount * 500,
      expensePaid: 0,
      contributedToFund: 0,
      receivedAsTreasurer: 0,
      settlementsPaid: 0,
      settlementsReceived: 0,
      balance: -(expenseCount * 500)
    },
    treasurerName: "ترانه",
    treasurerCardNumberGrouped: null,
    treasurerIbanGrouped: null,
    treasurerBankName: null,
    treasurerAccountHolder: null,
    hubSettlement: null,
    closingText: "با تشکر از همراهی شما."
  };
}

function payloadFor(data: MemberStatementData & { closingText: string }): StatementLinkPayload {
  return {
    v: 1,
    statementId: "s1",
    number: 1,
    issueVersion: 1,
    issuedAt: "2025-01-05T00:00:00.000Z",
    verificationCode: "A1B2-C3D4",
    status: "current",
    appVersion: "0.6.0",
    data
  };
}

describe("statement link encode/decode round-trip", () => {
  it("decodes back to an equivalent payload after encoding", () => {
    const payload = payloadFor(baseMemberData(2));
    const encoded = encodeStatementPayload(payload);
    const decoded = decodeStatementPayload(encoded);
    expect(decoded).toEqual(payload);
  });

  it("returns null for garbage input", () => {
    expect(decodeStatementPayload("not-a-valid-payload")).toBeNull();
  });
});

describe("statement link size-policy tiers", () => {
  it("uses the full tier when the URL comfortably fits", () => {
    const payload = payloadFor(baseMemberData(1));
    const result = buildStatementLink(payload, "https://tabpals.app/");
    expect(result.tier).toBe("full");
    expect(result.url).toContain("#/s/");
  });

  it("falls back to the reduced tier (dropping سهیم‌ها lines/explanations) when full is too long but reduced fits", () => {
    const payload = payloadFor(baseMemberData(10));
    const fullEncoded = encodeStatementPayload(payload);
    const fullUrl = `https://tabpals.app/#/s/${fullEncoded}`;

    // Pick a budget the full payload can't fit but a reduced one can.
    const maxLength = fullUrl.length - 50;
    const result = buildStatementLink(payload, "https://tabpals.app/", maxLength);

    expect(result.tier).toBe("reduced");
    expect(result.url).not.toBeNull();
    expect(result.url!.length).toBeLessThanOrEqual(maxLength);

    const decoded = decodeStatementPayload(result.encoded!);
    expect(decoded!.data.kind).toBe("member");
    if (decoded!.data.kind !== "comprehensive") {
      expect(decoded!.data.expenses.every((e) => e.participantNames.length === 0 && e.splitExplanation === "")).toBe(true);
    }
  });

  it("returns tier 'none' when even the reduced payload doesn't fit the budget", () => {
    const payload = payloadFor(baseMemberData(10));
    const result = buildStatementLink(payload, "https://tabpals.app/", 100);
    expect(result.tier).toBe("none");
    expect(result.url).toBeNull();
    expect(result.encoded).toBeNull();
  });
});
