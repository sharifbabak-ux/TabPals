import { describe, expect, it } from "vitest";
import {
  DIFFERENCE_EXTRA_LABEL,
  allocateExtra,
  buildDifferenceExtra,
  buildItemizedSnapshot,
  buildWaiterList,
  buildWaiterListText,
  bulkPriceLineIds,
  computePersonSubtotals,
  computeSession,
  defaultExtraLabel,
  extraTotalAmount,
  isDifferenceExtra,
  missingPriceGroups,
  recomputePayers,
  reconcile,
  validateFinalize,
  type ExtraInput,
  type LineInput
} from "./groupOrder";

let n = 0;
function line(personId: string | null, itemName: string, quantity: number, unitPrice?: number, extra: Partial<LineInput> = {}): LineInput {
  return { id: `l${++n}`, personId, itemName, quantity, unitPrice, ...extra };
}
function extra(partial: Partial<ExtraInput> & Pick<ExtraInput, "kind" | "mode" | "value">): ExtraInput {
  return { id: `x${++n}`, label: partial.kind, allocation: "proportional", ...partial };
}

describe("computePersonSubtotals", () => {
  it("sums quantity × unit price of a person's lines", () => {
    const [a] = computePersonSubtotals([line("a", "کوبیده", 2, 100), line("a", "دوغ", 1, 20)], []);
    expect(a.subtotal).toBe(220);
    expect(a.computable).toBe(true);
    expect(a.items).toHaveLength(2);
  });

  it("uses the per-person total when the person has no priced lines", () => {
    const [a] = computePersonSubtotals([line("a", "کوبیده", 2)], [{ personId: "a", total: 500 }]);
    expect(a.subtotal).toBe(500);
    expect(a.personTotal).toBe(500);
    expect(a.computable).toBe(true);
  });

  it("ignores the per-person total once the person has priced lines", () => {
    const [a] = computePersonSubtotals([line("a", "کوبیده", 1, 100)], [{ personId: "a", total: 999 }]);
    expect(a.subtotal).toBe(100);
    expect(a.personTotal).toBeNull();
  });

  it("is not computable when a line lacks a price and there is no total", () => {
    const [a] = computePersonSubtotals([line("a", "کوبیده", 1, 100), line("a", "دوغ", 1)], []);
    expect(a.computable).toBe(false);
  });

  it("includes persons who only have a per-person total", () => {
    const persons = computePersonSubtotals([], [{ personId: "z", total: 70 }]);
    expect(persons.map((p) => p.personId)).toEqual(["z"]);
    expect(persons[0].subtotal).toBe(70);
  });

  it("adds each participant's weighted share of shared lines with exact rounding", () => {
    const shared = line(null, "پیتزا", 1, 100, {
      sharedParticipants: [
        { personId: "a", weight: 1 },
        { personId: "b", weight: 1 },
        { personId: "c", weight: 1 }
      ]
    });
    const persons = computePersonSubtotals([shared, line("a", "دوغ", 1, 10)], []);
    expect(persons.map((p) => p.sharedSubtotal)).toEqual([34, 33, 33]);
    expect(persons.reduce((s, p) => s + p.sharedSubtotal, 0)).toBe(100);
    expect(persons[0].subtotal).toBe(44);
    expect(persons[0].sharedItems[0]).toMatchObject({ name: "پیتزا", quantity: 1, amount: 34 });
  });

  it("honours shared-line weights", () => {
    const shared = line(null, "سالاد", 2, 50, {
      sharedParticipants: [
        { personId: "a", weight: 3 },
        { personId: "b", weight: 1 }
      ]
    });
    const persons = computePersonSubtotals([shared], []);
    expect(persons.map((p) => p.subtotal)).toEqual([75, 25]);
  });

  it("marks participants of an unpriced shared line as not computable", () => {
    const shared = line(null, "پیتزا", 1, undefined, { sharedParticipants: [{ personId: "a", weight: 1 }] });
    const [a] = computePersonSubtotals([shared], []);
    expect(a.computable).toBe(false);
  });
});

describe("extras", () => {
  const subtotals = [
    { personId: "a", subtotal: 300 },
    { personId: "b", subtotal: 100 }
  ];

  it("computes percent extras on the sum of all subtotals", () => {
    expect(extraTotalAmount(extra({ kind: "vat", mode: "percent", value: 10 }), 400)).toBe(40);
    expect(extraTotalAmount(extra({ kind: "service", mode: "amount", value: 55 }), 400)).toBe(55);
  });

  it("makes discounts negative whatever sign was typed", () => {
    expect(extraTotalAmount(extra({ kind: "discount", mode: "percent", value: 10 }), 400)).toBe(-40);
    expect(extraTotalAmount(extra({ kind: "discount", mode: "amount", value: -25 }), 400)).toBe(-25);
  });

  it("allocates proportionally to subtotal", () => {
    const r = allocateExtra(extra({ kind: "vat", mode: "percent", value: 10 }), subtotals);
    expect(r.shares).toEqual([
      { personId: "a", share: 30 },
      { personId: "b", share: 10 }
    ]);
  });

  it("allocates equally", () => {
    const r = allocateExtra(extra({ kind: "tip", mode: "amount", value: 101, allocation: "equal" }), subtotals);
    expect(r.shares.map((s) => s.share)).toEqual([51, 50]);
  });

  it("allocates by weights", () => {
    const r = allocateExtra(
      extra({
        kind: "service",
        mode: "amount",
        value: 100,
        allocation: "weight",
        weights: [
          { personId: "a", weight: 1 },
          { personId: "b", weight: 3 }
        ]
      }),
      subtotals
    );
    expect(r.shares.map((s) => s.share)).toEqual([25, 75]);
  });

  it("rejects a weight allocation where nobody has a positive weight", () => {
    expect(() => allocateExtra(extra({ kind: "tip", mode: "amount", value: 10, allocation: "weight", weights: [] }), subtotals)).toThrow();
  });

  it("allocates a discount as negative shares that sum exactly", () => {
    const r = allocateExtra(extra({ kind: "discount", mode: "amount", value: 101 }), subtotals);
    expect(r.amount).toBe(-101);
    expect(r.shares.reduce((s, x) => s + x.share, 0)).toBe(-101);
    expect(r.shares.every((s) => s.share <= 0)).toBe(true);
  });

  it("always sums exactly for awkward amounts and all allocation rules", () => {
    const awkward = [
      { personId: "a", subtotal: 333 },
      { personId: "b", subtotal: 777 },
      { personId: "c", subtotal: 1 },
      { personId: "d", subtotal: 12345 }
    ];
    for (const allocation of ["proportional", "equal"] as const) {
      for (const value of [1, 7, 99, 100001]) {
        const r = allocateExtra(extra({ kind: "tip", mode: "amount", value, allocation }), awkward);
        expect(r.shares.reduce((s, x) => s + x.share, 0)).toBe(value);
      }
      const pct = allocateExtra(extra({ kind: "vat", mode: "percent", value: 9, allocation }), awkward);
      expect(pct.shares.reduce((s, x) => s + x.share, 0)).toBe(pct.amount);
    }
  });

  it("falls back to equal when proportional has nothing to go on", () => {
    const r = allocateExtra(extra({ kind: "tip", mode: "amount", value: 10 }), [
      { personId: "a", subtotal: 0 },
      { personId: "b", subtotal: 0 }
    ]);
    expect(r.shares.map((s) => s.share)).toEqual([5, 5]);
  });

  it("labels extras with their percent", () => {
    expect(defaultExtraLabel("vat", "percent", 10)).toBe("مالیات ۱۰٪");
    expect(defaultExtraLabel("tip", "amount", 5000)).toBe("انعام");
  });
});

describe("computeSession", () => {
  const lines = [
    line("a", "کوبیده", 2, 1000),
    line("b", "جوجه", 1, 1500),
    line("c", "دوغ", 3, 333),
    line(null, "سالاد", 1, 1000, {
      sharedParticipants: [
        { personId: "a", weight: 1 },
        { personId: "b", weight: 1 },
        { personId: "c", weight: 1 }
      ]
    })
  ];
  const extras = [
    extra({ kind: "vat", mode: "percent", value: 9 }),
    extra({ kind: "service", mode: "percent", value: 10, allocation: "equal" }),
    extra({ kind: "discount", mode: "amount", value: 200 })
  ];

  it("final totals sum exactly to the computed total, which equals subtotals + extras", () => {
    const s = computeSession(lines, [], extras);
    const extraSum = s.extras.reduce((sum, e) => sum + e.amount, 0);
    expect(s.computedTotal).toBe(s.subtotalSum + extraSum);
    expect(s.bills.reduce((sum, b) => sum + b.finalTotal, 0)).toBe(s.computedTotal);
    for (const e of s.extras) expect(e.shares.reduce((sum, x) => sum + x.share, 0)).toBe(e.amount);
    expect(s.allComputable).toBe(true);
  });

  it("applies percent extras to subtotals only, not on top of each other", () => {
    const s = computeSession(lines, [], extras);
    expect(s.extras[0].amount).toBe(Math.round((s.subtotalSum * 9) / 100));
    expect(s.extras[1].amount).toBe(Math.round(s.subtotalSum / 10));
  });

  it("flags incomplete pricing", () => {
    expect(computeSession([line("a", "کوبیده", 1)], [], []).allComputable).toBe(false);
  });
});

describe("reconciliation", () => {
  it("reports unset, match and mismatch", () => {
    expect(reconcile(1000, null).status).toBe("unset");
    expect(reconcile(1000, 1000)).toMatchObject({ status: "match", difference: 0 });
    expect(reconcile(1000, 1100)).toMatchObject({ status: "mismatch", difference: 100 });
    expect(reconcile(1000, 900).difference).toBe(-100);
  });

  it("allocating the difference as an extra makes the totals match", () => {
    const lines = [line("a", "x", 1, 100), line("b", "y", 1, 300)];
    const base = computeSession(lines, [], []);
    const difference = 123;
    const diffExtra = buildDifferenceExtra("d", difference, "proportional");
    expect(isDifferenceExtra(diffExtra)).toBe(true);
    expect(diffExtra.label).toBe(DIFFERENCE_EXTRA_LABEL);
    const after = computeSession(lines, [], [diffExtra]);
    expect(after.computedTotal).toBe(base.computedTotal + difference);
    expect(reconcile(after.computedTotal, base.computedTotal + difference).status).toBe("match");
  });

  it("supports a negative difference with an equal allocation", () => {
    const lines = [line("a", "x", 1, 100), line("b", "y", 1, 300)];
    const after = computeSession(lines, [], [buildDifferenceExtra("d", -51, "equal")]);
    expect(after.computedTotal).toBe(400 - 51);
    expect(after.extras[0].shares.map((s) => s.share)).toEqual([-26, -25]);
  });
});

describe("waiter list", () => {
  it("aggregates by normalized name and sums quantities", () => {
    const list = buildWaiterList([
      line("a", "كوبیده", 2, 1),
      line("b", "کوبیده", 1),
      line("c", " کوبیده ", 3),
      line("a", "دوغ", 1)
    ]);
    expect(list.map((i) => [i.name, i.quantity])).toEqual([
      ["كوبیده", 6],
      ["دوغ", 1]
    ]);
  });

  it("counts a shared line once, by its own quantity", () => {
    const list = buildWaiterList([
      line(null, "پیتزا", 2, 100, {
        sharedParticipants: [
          { personId: "a", weight: 1 },
          { personId: "b", weight: 1 },
          { personId: "c", weight: 1 }
        ]
      }),
      line("a", "پیتزا", 1)
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].quantity).toBe(3);
  });

  it("collects notes with their quantities", () => {
    const list = buildWaiterList([line("a", "کباب", 2, undefined, { note: "بدون پیاز" }), line("b", "کباب", 1, undefined, { note: "بدون پیاز" }), line("c", "کباب", 1)]);
    expect(list[0].notes).toEqual([{ text: "بدون پیاز", quantity: 3 }]);
  });

  it("formats as '۳ × کوبیده'", () => {
    const text = buildWaiterListText("شام", buildWaiterList([line("a", "کوبیده", 3), line("b", "دوغ", 1)]));
    expect(text).toBe("شام\n\n۳ × کوبیده\n۱ × دوغ");
  });
});

describe("bulk pricing and missing prices", () => {
  const lines = [line("a", "کوبیده", 2), line("b", "كوبیده", 1), line("c", "کوبیده", 1, 90), line("a", "دوغ", 1)];

  it("applies to every unpriced line with the same normalized name", () => {
    const ids = bulkPriceLineIds(lines, "کوبیده");
    expect(ids).toEqual([lines[0].id, lines[1].id]);
  });

  it("groups missing prices by item name", () => {
    const groups = missingPriceGroups(lines, []);
    expect(groups.map((g) => [g.name, g.quantity, g.lineCount])).toEqual([
      ["کوبیده", 3, 2],
      ["دوغ", 1, 1]
    ]);
  });

  it("does not ask for prices of a person who entered a total", () => {
    const groups = missingPriceGroups(lines, [{ personId: "a", total: 500 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lineCount).toBe(1);
  });
});

describe("recomputePayers", () => {
  it("recomputes equal/weight/percent payers from the bill total and keeps exact ones", () => {
    const eq = recomputePayers(1001, [{ personId: "a", amount: 0 }, { personId: "b", amount: 0 }], "equal");
    expect(eq.map((p) => p.amount)).toEqual([501, 500]);
    const w = recomputePayers(100, [{ personId: "a", amount: 0, weight: 1 }, { personId: "b", amount: 0, weight: 3 }], "weight");
    expect(w.map((p) => p.amount)).toEqual([25, 75]);
    const exact = [{ personId: "a", amount: 40 }, { personId: "b", amount: 60 }];
    expect(recomputePayers(100, exact, "exact")).toEqual(exact);
    expect(recomputePayers(777, [{ personId: "a", amount: 1 }], undefined)).toEqual([{ personId: "a", amount: 777 }]);
  });
});

describe("validateFinalize", () => {
  const lines = [line("a", "x", 1, 100), line("b", "y", 1, 300)];
  const computation = computeSession(lines, [], []);
  const ok = { status: "pricing", eventClosed: false, billTotal: 400, payers: [{ personId: "a", amount: 400 }], computation };

  it("passes when everything is resolved", () => {
    expect(validateFinalize(ok)).toEqual([]);
  });

  it("blocks a closed event or wrong status", () => {
    expect(validateFinalize({ ...ok, eventClosed: true }).length).toBeGreaterThan(0);
    expect(validateFinalize({ ...ok, status: "locked" }).length).toBeGreaterThan(0);
  });

  it("blocks an unresolved difference (option a)", () => {
    expect(validateFinalize({ ...ok, billTotal: 450, payers: [{ personId: "a", amount: 450 }] })).toHaveLength(1);
  });

  it("blocks missing bill total, payers that do not sum, or no payers", () => {
    expect(validateFinalize({ ...ok, billTotal: null })).toHaveLength(1);
    expect(validateFinalize({ ...ok, payers: [{ personId: "a", amount: 399 }] })).toHaveLength(1);
    expect(validateFinalize({ ...ok, payers: [] })).toHaveLength(1);
  });

  it("blocks people without a computable subtotal", () => {
    const incomplete = computeSession([line("a", "x", 1)], [], []);
    const errors = validateFinalize({ ...ok, computation: incomplete, nameOf: () => "علی" });
    expect(errors.some((e) => e.includes("علی"))).toBe(true);
  });

  it("blocks a negative final total", () => {
    const c = computeSession(lines, [], [extra({ kind: "discount", mode: "amount", value: 1000, allocation: "equal" })]);
    expect(validateFinalize({ ...ok, computation: c, billTotal: c.computedTotal }).some((e) => e.includes("منفی"))).toBe(true);
  });
});

describe("buildItemizedSnapshot", () => {
  it("captures items, shared shares, extra shares and final totals", () => {
    const lines = [
      line("a", "کوبیده", 2, 100),
      line("b", "دوغ", 1, 50),
      line(null, "سالاد", 1, 60, {
        sharedParticipants: [
          { personId: "a", weight: 1 },
          { personId: "b", weight: 1 }
        ]
      })
    ];
    const vat = extra({ kind: "vat", mode: "percent", value: 10, label: "مالیات ۱۰٪" });
    const computation = computeSession(lines, [], [vat]);
    const snap = buildItemizedSnapshot({ sessionId: "s", sessionTitle: "شام", restaurant: "نایب", billTotal: computation.computedTotal, computation });
    expect(snap.people).toHaveLength(2);
    const a = snap.people[0];
    expect(a.items[0]).toEqual({ name: "کوبیده", quantity: 2, unitPrice: 100, amount: 200 });
    expect(a.sharedItems).toEqual([{ name: "سالاد", quantity: 1, amount: 30 }]);
    expect(a.itemsSubtotal).toBe(230);
    expect(a.extras[0]).toMatchObject({ label: "مالیات ۱۰٪", share: 23 });
    expect(a.finalTotal).toBe(253);
    expect(snap.people.reduce((s, p) => s + p.finalTotal, 0)).toBe(snap.billTotal);
    expect(snap.extras[0].amount).toBe(computation.extras[0].amount);
  });
});
