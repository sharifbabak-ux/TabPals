import { describe, expect, it } from "vitest";
import { normalizeName } from "./nameNormalization";

describe("normalizeName", () => {
  it("maps Arabic ي/ك to Persian ی/ک", () => {
    expect(normalizeName("علي")).toBe(normalizeName("علی"));
    expect(normalizeName("كيان")).toBe(normalizeName("کیان"));
  });

  it("removes ZWNJ", () => {
    expect(normalizeName("می‌خواهم")).toBe(normalizeName("میخواهم"));
  });

  it("removes Arabic diacritics", () => {
    expect(normalizeName("عَلی")).toBe(normalizeName("علی"));
  });

  it("converts Persian and Arabic-Indic digits to one form", () => {
    expect(normalizeName("علی ۱۲")).toBe(normalizeName("علی 12"));
    expect(normalizeName("علی ١٢")).toBe(normalizeName("علی 12"));
  });

  it("trims and collapses internal whitespace", () => {
    expect(normalizeName("  علی    رضایی  ")).toBe("علی رضایی");
  });

  it("is case-insensitive for latin text", () => {
    expect(normalizeName("Ali")).toBe(normalizeName("ali"));
  });

  it("treats a name with ZWNJ and Arabic letters as equal to its Persian, space-joined form", () => {
    expect(normalizeName("علي‌رضا")).toBe(normalizeName("علیرضا"));
  });
});
