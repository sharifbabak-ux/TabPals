import { describe, expect, it } from "vitest";
import { amountsSumTo, percentsSumTo100, sharesFromExactAmounts, splitByWeight, splitEqual } from "./splitEngine";

function sumShares(shares: { share: number }[]): number {
  return shares.reduce((sum, s) => sum + s.share, 0);
}

describe("splitEqual", () => {
  it("splits evenly when the amount divides exactly", () => {
    const shares = splitEqual(300, ["p1", "p2", "p3"]);
    expect(shares).toEqual([
      { personId: "p1", share: 100 },
      { personId: "p2", share: 100 },
      { personId: "p3", share: 100 }
    ]);
  });

  it("distributes the remainder deterministically when the amount does not divide exactly", () => {
    const shares = splitEqual(100, ["p1", "p2", "p3"]);
    expect(sumShares(shares)).toBe(100);
    // 100/3 = 33.33..., all three have the same remainder (0.33); stable
    // order means the earliest entries get the extra unit first.
    expect(shares).toEqual([
      { personId: "p1", share: 34 },
      { personId: "p2", share: 33 },
      { personId: "p3", share: 33 }
    ]);
  });

  it("returns an empty list for no people", () => {
    expect(splitEqual(100, [])).toEqual([]);
  });

  it("gives the whole amount to a single person", () => {
    expect(splitEqual(100, ["p1"])).toEqual([{ personId: "p1", share: 100 }]);
  });

  it("always sums exactly to the amount across many odd divisions", () => {
    for (let amount = 1; amount <= 50; amount++) {
      for (let people = 1; people <= 7; people++) {
        const ids = Array.from({ length: people }, (_, i) => `p${i}`);
        expect(sumShares(splitEqual(amount, ids))).toBe(amount);
      }
    }
  });
});

describe("splitByWeight", () => {
  it("splits proportionally to weight", () => {
    const shares = splitByWeight(300, [
      { personId: "p1", weight: 1 },
      { personId: "p2", weight: 2 }
    ]);
    expect(shares).toEqual([
      { personId: "p1", share: 100 },
      { personId: "p2", share: 200 }
    ]);
  });

  it("distributes the remainder to the largest fractional remainder first", () => {
    // total weight 3, amount 10 -> 3.33, 3.33, 3.33 -> floors 3,3,3 remainder 1 unit left,
    // all remainders equal, so the first person (stable order) gets it.
    const shares = splitByWeight(10, [
      { personId: "p1", weight: 1 },
      { personId: "p2", weight: 1 },
      { personId: "p3", weight: 1 }
    ]);
    expect(sumShares(shares)).toBe(10);
    expect(shares[0]).toEqual({ personId: "p1", share: 4 });
  });

  it("gives a larger remainder priority over an earlier index", () => {
    // weights 1 and 3, amount 10 -> exact 2.5 and 7.5, floors 2 and 7, remainders equal (0.5)
    // -> earlier index (p1) wins the tie.
    const shares = splitByWeight(10, [
      { personId: "p1", weight: 1 },
      { personId: "p2", weight: 3 }
    ]);
    expect(sumShares(shares)).toBe(10);
  });

  it("throws when total weight is zero", () => {
    expect(() => splitByWeight(100, [{ personId: "p1", weight: 0 }])).toThrow();
  });

  it("throws on a negative weight", () => {
    expect(() => splitByWeight(100, [{ personId: "p1", weight: -1 }])).toThrow();
  });

  it("returns an empty list for no weights", () => {
    expect(splitByWeight(100, [])).toEqual([]);
  });

  it("always sums exactly to the amount for arbitrary weights", () => {
    const weights = [
      { personId: "p1", weight: 7 },
      { personId: "p2", weight: 11 },
      { personId: "p3", weight: 2 },
      { personId: "p4", weight: 5 }
    ];
    for (let amount = 1; amount <= 200; amount++) {
      expect(sumShares(splitByWeight(amount, weights))).toBe(amount);
    }
  });

  it("supports percent-style weights that sum to 100", () => {
    const shares = splitByWeight(1000, [
      { personId: "p1", weight: 25 },
      { personId: "p2", weight: 75 }
    ]);
    expect(shares).toEqual([
      { personId: "p1", share: 250 },
      { personId: "p2", share: 750 }
    ]);
  });
});

describe("sharesFromExactAmounts", () => {
  it("maps exact amounts directly to shares", () => {
    expect(sharesFromExactAmounts([{ personId: "p1", amount: 40 }, { personId: "p2", amount: 60 }])).toEqual([
      { personId: "p1", share: 40 },
      { personId: "p2", share: 60 }
    ]);
  });
});

describe("amountsSumTo", () => {
  it("returns true when values sum to the total", () => {
    expect(amountsSumTo(100, [40, 60])).toBe(true);
  });

  it("returns false when values do not sum to the total", () => {
    expect(amountsSumTo(100, [40, 50])).toBe(false);
  });

  it("returns true for an empty list only when the total is zero", () => {
    expect(amountsSumTo(0, [])).toBe(true);
    expect(amountsSumTo(10, [])).toBe(false);
  });
});

describe("percentsSumTo100", () => {
  it("returns true when percentages sum to 100", () => {
    expect(percentsSumTo100([25, 75])).toBe(true);
  });

  it("returns false otherwise", () => {
    expect(percentsSumTo100([25, 50])).toBe(false);
  });
});
