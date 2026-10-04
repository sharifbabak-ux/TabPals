import { describe, expect, it } from "vitest";
import { maskCardNumber, maskIban } from "./mask";

describe("masking", () => {
  it("masks a card number keeping first and last four digits", () => {
    expect(maskCardNumber("5859831012343724")).toBe("۵۸۵۹ ●●●● ●●●● ۳۷۲۴");
    expect(maskCardNumber("۵۸۵۹ ۸۳۱۰ ۱۲۳۴ ۳۷۲۴")).toBe("۵۸۵۹ ●●●● ●●●● ۳۷۲۴");
  });
  it("hides the middle of an IBAN", () => {
    const masked = maskIban("IR062960000000100324200001");
    expect(masked).toBe("IR۰۶ ●●●● ●●●● ●●●● ●●●● ۰۰۰۱");
    expect(masked).not.toContain("2960");
  });
  it("never reveals short garbage", () => {
    expect(maskCardNumber("12")).not.toContain("۱۲");
    expect(maskIban("IR1")).not.toContain("1");
  });
});
