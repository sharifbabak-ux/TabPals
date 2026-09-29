import { describe, expect, it } from "vitest";
import { computeHubSettlement } from "./hubSettlement";

describe("computeHubSettlement", () => {
  it("has every non-treasurer debtor pay the treasurer, and the treasurer pay every creditor", () => {
    const balances = [
      { personId: "treasurer", balance: 100 },
      { personId: "debtor1", balance: -300 },
      { personId: "debtor2", balance: -100 },
      { personId: "creditor1", balance: 300 }
    ];
    const plan = computeHubSettlement(balances, "treasurer");

    expect(plan.transfers).toContainEqual({ fromPersonId: "debtor1", toPersonId: "treasurer", amount: 300 });
    expect(plan.transfers).toContainEqual({ fromPersonId: "debtor2", toPersonId: "treasurer", amount: 100 });
    expect(plan.transfers).toContainEqual({ fromPersonId: "treasurer", toPersonId: "creditor1", amount: 300 });
    expect(plan.transfers).toHaveLength(3);
  });

  it("skips members with a zero balance", () => {
    const balances = [
      { personId: "treasurer", balance: 0 },
      { personId: "even", balance: 0 },
      { personId: "debtor", balance: -50 },
      { personId: "creditor", balance: 50 }
    ];
    const plan = computeHubSettlement(balances, "treasurer");
    expect(plan.transfers).toHaveLength(2);
  });

  it("invariant: totalCollected - totalPaidOut equals the treasurer's own balance, for any zero-sum balance set", () => {
    const cases: { personId: string; balance: number }[][] = [
      [
        { personId: "t", balance: 50 },
        { personId: "a", balance: -200 },
        { personId: "b", balance: 150 }
      ],
      [
        { personId: "t", balance: -80 },
        { personId: "a", balance: -20 },
        { personId: "b", balance: 100 }
      ],
      [
        { personId: "t", balance: 0 },
        { personId: "a", balance: -40 },
        { personId: "b", balance: 40 }
      ],
      [
        { personId: "t", balance: 500 },
        { personId: "a", balance: -500 }
      ]
    ];

    for (const balances of cases) {
      const total = balances.reduce((sum, b) => sum + b.balance, 0);
      expect(total).toBe(0);

      const treasurerBalance = balances.find((b) => b.personId === "t")!.balance;
      const plan = computeHubSettlement(balances, "t");
      expect(plan.totalCollected - plan.totalPaidOut).toBe(treasurerBalance);
    }
  });
});
