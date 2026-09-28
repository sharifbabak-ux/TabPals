import { describe, expect, it } from "vitest";
import { computeBalances, type BalanceVoucher } from "./balanceEngine";

describe("computeBalances", () => {
  it("credits a single payer and debits participants for an expense split equally", () => {
    const vouchers: BalanceVoucher[] = [
      {
        type: "expense",
        status: "active",
        totalAmount: 300,
        payers: [{ personId: "p1", amount: 300 }],
        shares: [
          { personId: "p1", share: 100 },
          { personId: "p2", share: 100 },
          { personId: "p3", share: 100 }
        ]
      }
    ];
    const balances = computeBalances(["p1", "p2", "p3"], vouchers);
    expect(balances).toEqual([
      { personId: "p1", totalPaid: 300, totalShare: 100, balance: 200 },
      { personId: "p2", totalPaid: 0, totalShare: 100, balance: -100 },
      { personId: "p3", totalPaid: 0, totalShare: 100, balance: -100 }
    ]);
  });

  it("supports multiple payers on one expense", () => {
    const vouchers: BalanceVoucher[] = [
      {
        type: "expense",
        status: "active",
        totalAmount: 200,
        payers: [
          { personId: "p1", amount: 150 },
          { personId: "p2", amount: 50 }
        ],
        shares: [
          { personId: "p1", share: 100 },
          { personId: "p2", share: 100 }
        ]
      }
    ];
    const balances = computeBalances(["p1", "p2"], vouchers);
    expect(balances.find((b) => b.personId === "p1")).toEqual({ personId: "p1", totalPaid: 150, totalShare: 100, balance: 50 });
    expect(balances.find((b) => b.personId === "p2")).toEqual({ personId: "p2", totalPaid: 50, totalShare: 100, balance: -50 });
  });

  it("handles a contribution: giver credited, treasurer debited", () => {
    const vouchers: BalanceVoucher[] = [
      { type: "contribution", status: "active", totalAmount: 500, fromPersonId: "p1", toPersonId: "treasurer" }
    ];
    const balances = computeBalances(["p1", "treasurer"], vouchers);
    expect(balances).toEqual([
      { personId: "p1", totalPaid: 500, totalShare: 0, balance: 500 },
      { personId: "treasurer", totalPaid: 0, totalShare: 500, balance: -500 }
    ]);
  });

  it("handles a settlement: payer credited, receiver debited", () => {
    const vouchers: BalanceVoucher[] = [
      { type: "settlement", status: "active", totalAmount: 100, fromPersonId: "a", toPersonId: "b" }
    ];
    const balances = computeBalances(["a", "b"], vouchers);
    expect(balances).toEqual([
      { personId: "a", totalPaid: 100, totalShare: 0, balance: 100 },
      { personId: "b", totalPaid: 0, totalShare: 100, balance: -100 }
    ]);
  });

  it("ignores void vouchers", () => {
    const vouchers: BalanceVoucher[] = [
      {
        type: "expense",
        status: "void",
        totalAmount: 300,
        payers: [{ personId: "p1", amount: 300 }],
        shares: [{ personId: "p1", share: 300 }]
      }
    ];
    const balances = computeBalances(["p1"], vouchers);
    expect(balances).toEqual([{ personId: "p1", totalPaid: 0, totalShare: 0, balance: 0 }]);
  });

  it("keeps zero balances for members with no vouchers", () => {
    const balances = computeBalances(["p1", "p2"], []);
    expect(balances).toEqual([
      { personId: "p1", totalPaid: 0, totalShare: 0, balance: 0 },
      { personId: "p2", totalPaid: 0, totalShare: 0, balance: 0 }
    ]);
  });

  it("invariant: balances always sum to zero across a mix of voucher types", () => {
    const vouchers: BalanceVoucher[] = [
      {
        type: "expense",
        status: "active",
        totalAmount: 100,
        payers: [{ personId: "p1", amount: 100 }],
        shares: [
          { personId: "p1", share: 34 },
          { personId: "p2", share: 33 },
          { personId: "p3", share: 33 }
        ]
      },
      {
        type: "expense",
        status: "active",
        totalAmount: 250,
        payers: [
          { personId: "p2", amount: 200 },
          { personId: "p3", amount: 50 }
        ],
        shares: [
          { personId: "p1", share: 84 },
          { personId: "p2", share: 83 },
          { personId: "p3", share: 83 }
        ]
      },
      { type: "contribution", status: "active", totalAmount: 500, fromPersonId: "p1", toPersonId: "treasurer" },
      { type: "settlement", status: "active", totalAmount: 40, fromPersonId: "p3", toPersonId: "p2" },
      {
        type: "expense",
        status: "void",
        totalAmount: 9999,
        payers: [{ personId: "p1", amount: 9999 }],
        shares: [{ personId: "p1", share: 9999 }]
      }
    ];
    const balances = computeBalances(["p1", "p2", "p3", "treasurer"], vouchers);
    const sum = balances.reduce((total, b) => total + b.balance, 0);
    expect(sum).toBe(0);
  });
});
