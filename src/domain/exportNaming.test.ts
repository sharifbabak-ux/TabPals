import { describe, expect, it } from "vitest";
import { buildStatementExportFilename, buildStatementExportFilenameBase, sanitizeFilenamePart } from "./exportNaming";

describe("sanitizeFilenamePart", () => {
  it("strips characters illegal in filenames", () => {
    expect(sanitizeFilenamePart('سفر: شمال/جنوب*?"<>|')).toBe("سفر شمالجنوب");
  });

  it("collapses whitespace", () => {
    expect(sanitizeFilenamePart("سفر   شمال")).toBe("سفر شمال");
  });
});

describe("buildStatementExportFilename", () => {
  it("builds the TabPals-<event>-<member>-<number>.<ext> pattern", () => {
    expect(buildStatementExportFilename("سفر شمال", "آرش ای", 3, "pdf")).toBe("TabPals-سفر شمال-آرش ای-3.pdf");
  });
});

describe("buildStatementExportFilenameBase", () => {
  it("builds the same pattern without an extension", () => {
    expect(buildStatementExportFilenameBase("سفر شمال", "آرش ای", 3)).toBe("TabPals-سفر شمال-آرش ای-3");
  });
});
