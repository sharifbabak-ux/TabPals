import { describe, expect, it } from "vitest";
import { buildInviteUrl, formatShortCode, isValidShortCode, normalizeShortCode, parseInviteLinkCode, parseInviteToken } from "./inviteLink";

describe("invite URL building", () => {
  it("builds APP_BASE_URL + #/join?t=<token>", () => {
    expect(buildInviteUrl("https://sharifbabak-ux.github.io/TabPals/", "abc123")).toBe("https://sharifbabak-ux.github.io/TabPals/#/join?t=abc123");
  });
  it("tolerates a missing trailing slash and a base carrying a hash/query", () => {
    expect(buildInviteUrl("https://x.example/app", "t")).toBe("https://x.example/app/#/join?t=t");
    expect(buildInviteUrl("https://x.example/app/#/events?z=1", "t")).toBe("https://x.example/app/#/join?t=t");
  });
  it("encodes unusual token characters and round-trips", () => {
    const url = buildInviteUrl("https://x.example/", "a+b/c=d&e");
    expect(url).toContain("t=a%2Bb%2Fc%3Dd%26e");
    expect(parseInviteToken(url)).toBe("a+b/c=d&e");
  });
});

describe("short code inside the link", () => {
  it("is appended as &c= (normalized) and read back; the token stays first", () => {
    const url = buildInviteUrl("https://x.example/TabPals/", "tok", "abcd-2345");
    expect(url).toBe("https://x.example/TabPals/#/join?t=tok&c=ABCD2345");
    expect(parseInviteToken(url)).toBe("tok");
    expect(parseInviteLinkCode(url)).toBe("ABCD2345");
  });
  it("ignores a missing or malformed code", () => {
    expect(parseInviteLinkCode("https://x.example/#/join?t=tok")).toBeNull();
    expect(parseInviteLinkCode("https://x.example/#/join?t=tok&c=12")).toBeNull();
    expect(parseInviteLinkCode("https://x.example/#/events?c=ABCD2345")).toBeNull();
  });
});

describe("parseInviteToken", () => {
  it("reads full links, hash fragments and router locations", () => {
    expect(parseInviteToken("https://s.io/TabPals/#/join?t=tok_1-x")).toBe("tok_1-x");
    expect(parseInviteToken("#/join?t=tok")).toBe("tok");
    expect(parseInviteToken("/join?t=tok")).toBe("tok");
    expect(parseInviteToken("  https://s.io/#/join?t=tok  ")).toBe("tok");
  });
  it("rejects anything that is not a join link", () => {
    expect(parseInviteToken("")).toBeNull();
    expect(parseInviteToken("https://s.io/#/events?t=tok")).toBeNull();
    expect(parseInviteToken("https://s.io/#/join")).toBeNull();
    expect(parseInviteToken("https://s.io/#/join?x=1")).toBeNull();
    expect(parseInviteToken("hello")).toBeNull();
  });
});

describe("short code", () => {
  it("formats 8 chars as XXXX-XXXX", () => {
    expect(formatShortCode("abcd2345")).toBe("ABCD-2345");
    expect(formatShortCode("ABCD")).toBe("ABCD");
    expect(formatShortCode("abcd23")).toBe("ABCD-23");
    expect(formatShortCode("ABCD23456789XYZ")).toBe("ABCD-2345");
  });
  it("normalizes case, spaces, dashes and Persian digits; drops look-alike letters", () => {
    expect(normalizeShortCode(" abcd - ۲۳۴۵ ")).toBe("ABCD2345");
    expect(normalizeShortCode("ab0o1i-lcd")).toBe("ABLCD");
  });
  it("validates length 8 after normalization", () => {
    expect(isValidShortCode("ABCD-2345")).toBe(true);
    expect(isValidShortCode("abcd 2345")).toBe(true);
    expect(isValidShortCode("ABCD-234")).toBe(false);
    expect(isValidShortCode("")).toBe(false);
  });
});
