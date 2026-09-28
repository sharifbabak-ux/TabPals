import { describe, expect, it } from "vitest";
import { parseAmountInput } from "./amountInput";

describe("parseAmountInput", () => {
  it("parses plain English digits", () => {
    expect(parseAmountInput("1234567")).toBe(1234567);
  });

  it("parses Persian digits", () => {
    expect(parseAmountInput("۱۲۳۴۵۶۷")).toBe(1234567);
  });

  it("parses Arabic-Indic digits", () => {
    expect(parseAmountInput("١٢٣")).toBe(123);
  });

  it("strips English thousand separators", () => {
    expect(parseAmountInput("1,234,567")).toBe(1234567);
  });

  it("strips Persian thousand separators (٬)", () => {
    expect(parseAmountInput("۱٬۲۳۴٬۵۶۷")).toBe(1234567);
  });

  it("strips spaces used as separators", () => {
    expect(parseAmountInput("1 234 567")).toBe(1234567);
  });

  it("truncates a decimal amount to a whole unit", () => {
    expect(parseAmountInput("1234.9")).toBe(1234);
  });

  it("returns 0 for empty input", () => {
    expect(parseAmountInput("")).toBe(0);
  });

  it("returns 0 for non-numeric input", () => {
    expect(parseAmountInput("abc")).toBe(0);
  });

  it("handles mixed Persian digits and separators together", () => {
    expect(parseAmountInput("۲۵۰٬۰۰۰")).toBe(250000);
  });
});
