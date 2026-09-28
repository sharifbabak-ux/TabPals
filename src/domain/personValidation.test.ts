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
  });

  it("blocks a duplicate name instead of just warning", () => {
    const result = validatePersonName("Ali", ["Ali"]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Ali");
  });

  it("blocks duplicates case-insensitively and after trimming whitespace", () => {
    const result = validatePersonName("  ali  ", ["Ali"]);
    expect(result.valid).toBe(false);
  });

  it("does not flag a name as duplicate when names differ", () => {
    const result = validatePersonName("Ali", ["Alireza"]);
    expect(result.valid).toBe(true);
  });

  it("blocks duplicates that only differ by Arabic/Persian letter variants", () => {
    const result = validatePersonName("علي رضایی", ["علی رضایی"]);
    expect(result.valid).toBe(false);
  });

  it("blocks duplicates that only differ by digit script", () => {
    const result = validatePersonName("رضا ۲", ["رضا 2"]);
    expect(result.valid).toBe(false);
  });

  it("suggests adding a distinguishing detail in the error message", () => {
    const result = validatePersonName("علی رضایی", ["علی رضایی"]);
    expect(result.error).toContain("کرج");
  });
});
