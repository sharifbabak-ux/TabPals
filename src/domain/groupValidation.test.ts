import { describe, expect, it } from "vitest";
import { validateGroupName } from "./groupValidation";

describe("validateGroupName", () => {
  it("rejects an empty name", () => {
    expect(validateGroupName("", []).valid).toBe(false);
  });

  it("accepts a unique name", () => {
    const result = validateGroupName("خانواده", ["دوستان"]);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it("blocks a duplicate name", () => {
    const result = validateGroupName("خانواده", ["خانواده"]);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("خانواده");
  });

  it("blocks duplicates after normalization (Arabic letters, digits, spacing)", () => {
    const result = validateGroupName("كوهنوردي  ۲", ["کوهنوردی 2"]);
    expect(result.valid).toBe(false);
  });
});
