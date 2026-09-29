import { describe, expect, it } from "vitest";
import { detectBankFromCardNumber, detectBankFromIban } from "./bankDetection";

describe("detectBankFromCardNumber", () => {
  it("recognizes a known IIN", () => {
    expect(detectBankFromCardNumber("6037991234567890")).toBe("بانک ملی ایران");
  });

  it("accepts Persian digits and separators", () => {
    expect(detectBankFromCardNumber("۶۰۳۷-۹۹۱۲-۳۴۵۶-۷۸۹۰")).toBe("بانک ملی ایران");
  });

  it("returns null for an unrecognized prefix", () => {
    expect(detectBankFromCardNumber("9999991234567890")).toBeNull();
  });

  it("returns null when too short to contain an IIN", () => {
    expect(detectBankFromCardNumber("60379")).toBeNull();
  });
});

describe("detectBankFromIban", () => {
  it("recognizes a known bank code with the IR prefix", () => {
    expect(detectBankFromIban("IR820540102680020817909002")).toBe("بانک پارسیان");
  });

  it("recognizes a known bank code without the IR prefix", () => {
    expect(detectBankFromIban("820540102680020817909002")).toBe("بانک پارسیان");
  });

  it("returns null for an unrecognized bank code", () => {
    expect(detectBankFromIban("IR820990102680020817909002")).toBeNull();
  });
});
