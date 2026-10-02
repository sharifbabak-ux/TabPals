import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ComprehensiveReportData, MemberStatementData } from "@/domain/statementBuilder";
import { buildSummaryLink, type StatementLinkPayload } from "@/domain/statementLink";
import { SharedStatementScreen, SUMMARY_NOTE } from "../SharedStatementScreen";
import { ComprehensiveReportView } from "./ComprehensiveReportView";
import { MemberStatementView } from "./MemberStatementView";
import { StatementPaper, type StatementPaperMeta } from "./StatementPaper";

const meta: StatementPaperMeta = {
  number: 1,
  issueVersion: 1,
  issuedAt: "2025-01-05T08:00:00.000Z",
  verificationCode: "A1B2-C3D4",
  status: "current",
  appVersion: "0.7.1"
};

function comprehensive(totalContributed: number, totalPaidByTreasurer: number): ComprehensiveReportData {
  return {
    kind: "comprehensive",
    event: { title: "سفر", currency: "تومان" },
    members: [],
    ledger: [],
    fundAccount: { contributions: [], treasurerExpensePayments: [], totalContributed, totalPaidByTreasurer, remaining: totalContributed - totalPaidByTreasurer },
    memberSummaries: [],
    hubSettlement: null,
    controlChecks: []
  };
}

function treasurerStatement(fundSummary?: MemberStatementData["fundSummary"]): MemberStatementData {
  return {
    kind: "treasurer",
    event: { title: "سفر", currency: "تومان" },
    member: { personId: "t", name: "ترانه", firstName: "ترانه", lastName: "تی" },
    expenses: [],
    expenseTotals: { totalAmount: 0, totalShare: 0, totalPaid: 0 },
    fundEntries: [],
    summary: { personId: "t", expenseShare: 0, expensePaid: 0, contributedToFund: 0, receivedAsTreasurer: 0, settlementsPaid: 0, settlementsReceived: 0, balance: 0 },
    treasurerName: "ترانه",
    treasurerCardNumberGrouped: null,
    treasurerIbanGrouped: null,
    treasurerBankName: null,
    treasurerAccountHolder: null,
    hubSettlement: null,
    fundSummary
  };
}

describe("fund section wording (GO-1.1)", () => {
  it("comprehensive report: never a negative «باقیمانده‌ی صندوق»; states personal payment", () => {
    const html = renderToStaticMarkup(createElement(ComprehensiveReportView, { data: comprehensive(1000, 3500) }));
    expect(html).toContain("مسئول صندوق ۲٬۵۰۰ تومان از محل شخصی پرداخت کرده است");
    expect(html).not.toContain("باقیمانده‌ی صندوق");
    expect(html).not.toMatch(/-\d|‎-/);
  });

  it("comprehensive report: shows «موجودی صندوق» when contributions exceed spending", () => {
    const html = renderToStaticMarkup(createElement(ComprehensiveReportView, { data: comprehensive(5000, 1000) }));
    expect(html).toContain("موجودی صندوق: ۴٬۰۰۰ تومان");
  });

  it("treasurer statement: same wording in its fund section", () => {
    const personal = renderToStaticMarkup(createElement(MemberStatementView, { data: treasurerStatement({ totalContributed: 0, totalPaidByTreasurer: 700 }), closingText: "x" }));
    expect(personal).toContain("مسئول صندوق ۷۰۰ تومان از محل شخصی پرداخت کرده است");
    const fund = renderToStaticMarkup(createElement(MemberStatementView, { data: treasurerStatement({ totalContributed: 900, totalPaidByTreasurer: 700 }), closingText: "x" }));
    expect(fund).toContain("موجودی صندوق: ۲۰۰ تومان");
  });

  it("treasurer statements issued before this stage (no fundSummary) still render", () => {
    const html = renderToStaticMarkup(createElement(MemberStatementView, { data: treasurerStatement(undefined), closingText: "x" }));
    expect(html).not.toContain("موجودی صندوق");
  });
});

describe("outdated status label (GO-1.1)", () => {
  it("shows «نیازمند صدور مجدد», never «منسوخ»", () => {
    const html = renderToStaticMarkup(createElement(StatementPaper, { data: { ...treasurerStatement(), closingText: "x" }, meta: { ...meta, status: "outdated" } }));
    expect(html).toContain("نیازمند صدور مجدد");
    expect(html).not.toContain("منسوخ");
  });
});

describe("shared summary link view (GO-1.1)", () => {
  it("renders the summary tier with the «summary version» note", () => {
    const payload: StatementLinkPayload = {
      v: 1,
      statementId: "s",
      number: 1,
      issueVersion: 1,
      issuedAt: "2025-01-05T08:00:00.000Z",
      verificationCode: "A1B2-C3D4",
      status: "current",
      appVersion: "0.7.1",
      data: { ...treasurerStatement(), kind: "member", member: { personId: "p", name: "آرش", firstName: "آرش", lastName: "احمدی" }, summary: { ...treasurerStatement().summary, balance: -2500 }, treasurerCardNumberGrouped: "6037 9972 1234 5678", closingText: "x" }
    };
    const { encoded } = buildSummaryLink(payload, "http://localhost/");
    const html = renderToStaticMarkup(
      createElement(MemoryRouter, { initialEntries: [`/s/${encoded}`] }, createElement(Routes, null, createElement(Route, { path: "/s/:payload", element: createElement(SharedStatementScreen) })))
    );
    expect(SUMMARY_NOTE).toBe("این نسخه‌ی خلاصه است؛ صورت‌حساب کامل را از مسئول صندوق بگیرید");
    expect(html).toContain(SUMMARY_NOTE);
    expect(html).toContain("آرش احمدی");
    expect(html).toContain("۲٬۵۰۰ تومان بدهکار به صندوق");
    expect(html).toContain("6037 9972 1234 5678");
    expect(html).toContain("A1B2-C3D4");
  });
});
