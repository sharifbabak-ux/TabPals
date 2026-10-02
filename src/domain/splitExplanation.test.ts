import { describe, expect, it } from "vitest";
import { buildSplitExplanation } from "./splitExplanation";

describe("buildSplitExplanation", () => {
  it("equal: names the participant count and shows amount ÷ count", () => {
    const voucher = {
      splitMode: "equal" as const,
      totalAmount: 4000000,
      participants: [
        { personId: "p1", weight: 1 },
        { personId: "p2", weight: 1 },
        { personId: "p3", weight: 1 },
        { personId: "p4", weight: 1 }
      ]
    };
    expect(buildSplitExplanation(voucher, "p1")).toBe("مساوی بین ۴ نفر (۴٬۰۰۰٬۰۰۰ ÷ ۴)");
  });

  it("weight: shows this member's weight over the total", () => {
    const voucher = {
      splitMode: "weight" as const,
      totalAmount: 1000,
      participants: [
        { personId: "p1", weight: 2 },
        { personId: "p2", weight: 3 }
      ]
    };
    expect(buildSplitExplanation(voucher, "p1")).toBe("ضریب ۲ از مجموع ۵");
  });

  it("percent: shows this member's percent of the amount", () => {
    const voucher = {
      splitMode: "percent" as const,
      totalAmount: 1000,
      participants: [
        { personId: "p1", weight: 25 },
        { personId: "p2", weight: 75 }
      ]
    };
    expect(buildSplitExplanation(voucher, "p1")).toBe("۲۵٪ از مبلغ");
  });

  it("exact: always returns the fixed label", () => {
    const voucher = {
      splitMode: "exact" as const,
      totalAmount: 1000,
      participants: [{ personId: "p1", weight: 600 }]
    };
    expect(buildSplitExplanation(voucher, "p1")).toBe("مبلغ مشخص");
  });
});

describe("buildSplitExplanation — itemized", () => {
  const person = {
    personId: "a",
    items: [{ name: "کوبیده", quantity: 2, unitPrice: 120000, amount: 240000 }],
    personTotal: null,
    sharedItems: [{ name: "سالاد", quantity: 1, amount: 15000 }],
    itemsSubtotal: 255000,
    extras: [
      { extraId: "x1", kind: "vat" as const, label: "مالیات ۱۰٪", share: 25500 },
      { extraId: "x2", kind: "service" as const, label: "سرویس", share: 13000 },
      { extraId: "x3", kind: "tip" as const, label: "انعام", share: 0 }
    ],
    finalTotal: 293500
  };

  it("lists the member's items and each extra's share", () => {
    const text = buildSplitExplanation({ splitMode: "itemized", totalAmount: 1, participants: [], itemizedPeople: [person] }, "a");
    const [itemsLine, extrasLine] = text.split("\n");
    expect(itemsLine).toContain("۲ × کوبیده");
    expect(itemsLine).toContain("۱۲۰٬۰۰۰");
    expect(itemsLine).toContain("سالاد");
    expect(extrasLine).toBe("سهم مالیات ۱۰٪: ۲۵٬۵۰۰، سهم سرویس: ۱۳٬۰۰۰");
  });

  it("falls back to a generic label when the snapshot lacks the person", () => {
    expect(buildSplitExplanation({ splitMode: "itemized", totalAmount: 1, participants: [] }, "zzz")).toBe("بر اساس سفارش");
  });
});
