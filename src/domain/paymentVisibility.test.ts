import { describe, expect, it } from "vitest";
import { fillCreditorBankDetails, hasPaymentDetails, hidePaymentDetails } from "./paymentVisibility";
import type { MemberStatementData } from "./statementBuilder";
import type { StatementLinkData } from "./statementLink";

function statement(): MemberStatementData & { closingText: string } {
  return {
    kind: "treasurer",
    event: { title: "سفر", currency: "تومان" },
    member: { personId: "t", name: "علی", firstName: "علی", lastName: "رضایی" },
    expenses: [],
    expenseTotals: { totalAmount: 0, totalShare: 0, totalPaid: 0 },
    fundEntries: [],
    summary: { balance: 0 } as never,
    treasurerName: "علی",
    treasurerCardNumberGrouped: "6037 9912 3456 7802",
    treasurerIbanGrouped: null,
    treasurerBankName: "ملی",
    treasurerAccountHolder: "علی رضایی",
    hubSettlement: {
      paysToTreasurer: [],
      paysFromTreasurer: [
        { personId: "s", name: "سارا", amount: 10 },
        { personId: "n", name: "نگار", amount: 5, cardNumberGrouped: "1111" }
      ],
      totalCollected: 0,
      totalPaidOut: 15
    },
    closingText: ""
  };
}

describe("payment visibility", () => {
  it("fills creditors' bank details from local profiles at render time, without touching rows that already have them", () => {
    const filled = fillCreditorBankDetails(statement() as StatementLinkData, new Map([["s", { cardNumber: "5859831012343728", bankName: "تجارت" }], ["n", { cardNumber: "6104337812345674" }]])) as MemberStatementData;
    expect(filled.hubSettlement!.paysFromTreasurer[0]).toMatchObject({ cardNumberGrouped: "5859 8310 1234 3728", bankName: "تجارت" });
    expect(filled.hubSettlement!.paysFromTreasurer[1].cardNumberGrouped).toBe("1111");
  });

  it("leaves rows empty when the profile is unknown or still encrypted", () => {
    const filled = fillCreditorBankDetails(statement() as StatementLinkData, new Map([["s", { cardNumber: "enc:v1:aa:bb" }]])) as MemberStatementData;
    expect(filled.hubSettlement!.paysFromTreasurer[0].cardNumberGrouped).toBeUndefined();
  });

  it("hides every payment detail but keeps the treasurer's name and the amounts", () => {
    const hidden = hidePaymentDetails(statement() as StatementLinkData) as MemberStatementData;
    expect(hidden.treasurerName).toBe("علی");
    expect(hidden.treasurerCardNumberGrouped).toBeNull();
    expect(hidden.treasurerBankName).toBeNull();
    expect(hidden.treasurerAccountHolder).toBeNull();
    expect(hidden.hubSettlement!.paysFromTreasurer.map((r) => [r.amount, r.cardNumberGrouped])).toEqual([[10, undefined], [5, undefined]]);
    expect(hasPaymentDetails(hidden as StatementLinkData)).toBe(false);
    expect(hasPaymentDetails(statement())).toBe(true);
  });
});
