import { describe, expect, it } from "vitest";
import { normalizeIranianPhone } from "./phoneNormalization";

describe("normalizeIranianPhone", () => {
  it("normalizes the local 09xxxxxxxxx form", () => {
    expect(normalizeIranianPhone("09123456789")).toBe("989123456789");
  });

  it("normalizes a +98 international form", () => {
    expect(normalizeIranianPhone("+989123456789")).toBe("989123456789");
  });

  it("normalizes a 0098 international form", () => {
    expect(normalizeIranianPhone("00989123456789")).toBe("989123456789");
  });

  it("normalizes a bare 10-digit local number with no leading zero", () => {
    expect(normalizeIranianPhone("9123456789")).toBe("989123456789");
  });

  it("converts Persian digits before normalizing", () => {
    expect(normalizeIranianPhone("۰۹۱۲۳۴۵۶۷۸۹")).toBe("989123456789");
  });

  it("strips spaces and dashes", () => {
    expect(normalizeIranianPhone("0912 345 6789")).toBe("989123456789");
    expect(normalizeIranianPhone("0912-345-6789")).toBe("989123456789");
  });

  it("returns null for empty or missing input", () => {
    expect(normalizeIranianPhone("")).toBeNull();
    expect(normalizeIranianPhone(undefined)).toBeNull();
    expect(normalizeIranianPhone(null)).toBeNull();
  });

  it("returns null for a landline or otherwise invalid number", () => {
    expect(normalizeIranianPhone("02112345678")).toBeNull();
    expect(normalizeIranianPhone("091234")).toBeNull();
    expect(normalizeIranianPhone("not a phone")).toBeNull();
  });
});
