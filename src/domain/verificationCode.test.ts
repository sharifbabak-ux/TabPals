import { describe, expect, it } from "vitest";
import { canonicalJson, computeVerificationCode } from "./verificationCode";

describe("canonicalJson", () => {
  it("sorts object keys recursively regardless of input order", () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });
});

describe("computeVerificationCode", () => {
  it("matches the known SHA-256 digest of the empty string", async () => {
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85
    expect(await computeVerificationCode("")).toBe("E3B0-C442");
  });

  it("is deterministic for the same canonical snapshot", async () => {
    const snapshot = canonicalJson({ eventId: "e1", total: 1000 });
    const code1 = await computeVerificationCode(snapshot);
    const code2 = await computeVerificationCode(snapshot);
    expect(code1).toBe(code2);
    expect(code1).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  it("differs when the snapshot content differs", async () => {
    const code1 = await computeVerificationCode(canonicalJson({ total: 1000 }));
    const code2 = await computeVerificationCode(canonicalJson({ total: 1001 }));
    expect(code1).not.toBe(code2);
  });
});
