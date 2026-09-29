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
