import { describe, expect, it } from "vitest";
import { validatePersonName } from "./personValidation";

describe("validatePersonName", () => {
  it("rejects an empty first name", () => {
    const result = validatePersonName("", "Rezaei", [{ firstName: "Ali", lastName: "Rezaei" }]);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects an empty last name", () => {
    const result = validatePersonName("Ali", "", []);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("rejects a name that is only whitespace", () => {
    const result = validatePersonName("   ", "   ", []);
    expect(result.valid).toBe(false);
  });

  it("accepts a non-empty unique name", () => {
    const result = validatePersonName("Ali", "Rezaei", [{ firstName: "Sara", lastName: "Ahmadi" }]);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("blocks a duplicate first+last name combination instead of just warning", () => {
    const result = validatePersonName("Ali", "Rezaei", [{ firstName: "Ali", lastName: "Rezaei" }]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Ali");
  });

  it("blocks duplicates case-insensitively and after trimming whitespace", () => {
    const result = validatePersonName("  ali  ", "  rezaei  ", [{ firstName: "Ali", lastName: "Rezaei" }]);
    expect(result.valid).toBe(false);
  });

  it("does not flag as duplicate when the last name differs", () => {
    const result = validatePersonName("Ali", "Rezaei", [{ firstName: "Ali", lastName: "Ahmadi" }]);
    expect(result.valid).toBe(true);
  });

  it("does not flag as duplicate when the first name differs", () => {
    const result = validatePersonName("Alireza", "Rezaei", [{ firstName: "Ali", lastName: "Rezaei" }]);
    expect(result.valid).toBe(true);
  });

  it("blocks duplicates that only differ by Arabic/Persian letter variants", () => {
    const result = validatePersonName("علي", "رضایی", [{ firstName: "علی", lastName: "رضایی" }]);
    expect(result.valid).toBe(false);
  });

  it("blocks duplicates that only differ by digit script", () => {
    const result = validatePersonName("رضا", "۲", [{ firstName: "رضا", lastName: "2" }]);
    expect(result.valid).toBe(false);
  });

  it("suggests adding a distinguishing detail in the error message", () => {
    const result = validatePersonName("علی", "رضایی", [{ firstName: "علی", lastName: "رضایی" }]);
    expect(result.error).toContain("کرج");
  });
});
