import { describe, expect, it } from "vitest";
import { buildStatementLink, buildSummaryLink, decodeSharedPayload, decodeStatementPayload, encodeStatementPayload, type StatementLinkPayload } from "./statementLink";
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

describe("summary link (GO-1.1)", () => {
  const BASE = "https://sharifbabak-ux.github.io/TabPals/";

  function summaryPayload(): StatementLinkPayload {
    const data = {
      ...baseMemberData(30),
      member: { personId: "p1", name: "آرش", firstName: "آرش", lastName: "احمدی‌نژاد" },
      event: { title: "سفر شمال – تابستان", currency: "تومان" },
      treasurerName: "ترانه تی",
      treasurerCardNumberGrouped: "6037 9972 1234 5678",
      treasurerIbanGrouped: "IR12 0170 0000 0010 0123 4567 89"
    };
    return payloadFor(data);
  }

  it("stays within 300 characters and is independent of the number of expenses", () => {
    const small = buildSummaryLink(summaryPayload(), BASE);
    expect(small.url.length).toBeLessThanOrEqual(300);
    const big = buildSummaryLink({ ...summaryPayload(), data: baseMemberData(500) }, BASE);
    expect(big.url.length).toBeLessThanOrEqual(300);
  });

  it("carries name, event, issue date, balance, currency, treasurer, card, IBAN and verification code", () => {
    const { url } = buildSummaryLink(summaryPayload(), BASE);
    expect(url.startsWith(`${BASE}#/s/`)).toBe(true);
    const decoded = decodeSharedPayload(url.split("#/s/")[1]);
    expect(decoded?.tier).toBe("summary");
    expect(decoded?.payload).toMatchObject({
      k: "m",
      n: "آرش احمدی‌نژاد",
      e: "سفر شمال – تابستان",
      d: "2025-01-05",
      b: -15000,
      c: "تومان",
      r: "ترانه تی",
      cd: "6037997212345678",
      ib: "IR120170000000100123456789",
      vc: "A1B2-C3D4"
    });
  });

  it("omits card and IBAN when the treasurer has none", () => {
    const { payload } = buildSummaryLink(payloadFor(baseMemberData(1)), BASE);
    expect(payload.cd).toBeUndefined();
    expect(payload.ib).toBeUndefined();
  });

  it("drops the IBAN, then the card, to honor a tighter URL budget", () => {
    const loose = buildSummaryLink(summaryPayload(), BASE, 10_000);
    const tight = buildSummaryLink(summaryPayload(), BASE, loose.url.length - 1);
    expect(tight.payload.ib).toBeUndefined();
    expect(tight.payload.n).toBe("آرش احمدی‌نژاد");
    expect(tight.payload.vc).toBe("A1B2-C3D4");
  });

  it("decodeSharedPayload still decodes full links and rejects garbage", () => {
    const full = buildStatementLink(payloadFor(baseMemberData(1)), BASE);
    expect(decodeSharedPayload(full.encoded!)?.tier).toBe("full");
    expect(decodeSharedPayload("garbage")).toBeNull();
  });
});
