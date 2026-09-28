import { describe, expect, it } from "vitest";
import { validatePersonName } from "./personValidation";

describe("validatePersonName", () => {
  it("rejects an empty name", () => {
    const result = validatePersonName("", ["Ali"]);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects a name that is only whitespace", () => {
    const result = validatePersonName("   ", []);
    expect(result.valid).toBe(false);
  });

  it("accepts a non-empty unique name", () => {
    const result = validatePersonName("Ali", ["Sara"]);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.isDuplicate).toBe(false);
  });

  it("warns on a duplicate name but still allows saving", () => {
    const result = validatePersonName("Ali", ["Ali"]);
    expect(result.valid).toBe(true);
    expect(result.isDuplicate).toBe(true);
  });

  it("treats duplicate detection as case-insensitive and trims whitespace", () => {
    const result = validatePersonName("  ali  ", ["Ali"]);
    expect(result.valid).toBe(true);
    expect(result.isDuplicate).toBe(true);
  });

  it("does not flag a duplicate when names differ", () => {
    const result = validatePersonName("Ali", ["Alireza"]);
    expect(result.isDuplicate).toBe(false);
  });
});
