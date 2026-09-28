import { describe, expect, it } from "vitest";
import { normalizeDigits, validateCardNumber, validateIban } from "./paymentValidation";

/** Builds a Luhn-valid 16-digit card number from a 15-digit prefix. */
function buildValidCard(prefix15: string): string {
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    let d = Number(prefix15[14 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  const check = (10 - (sum % 10)) % 10;
  return prefix15 + check;
}

/** Computes valid ISO 7064 MOD 97-10 check digits for a given country code + BBAN. */
function buildValidIban(countryCode: string, bban: string): string {
  const rearranged = bban + countryCode + "00";
  const numeric = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  const check = String(98 - remainder).padStart(2, "0");
  return `${countryCode}${check}${bban}`;
}

describe("normalizeDigits", () => {
  it("converts Persian and Arabic digits to ASCII", () => {
    expect(normalizeDigits("۱۲۳٤٥")).toBe("12345");
  });

  it("leaves ASCII digits and other characters untouched", () => {
    expect(normalizeDigits("IR12 34")).toBe("IR12 34");
  });
});

describe("validateCardNumber", () => {
  const validCard = buildValidCard("603799123456780");

  it("accepts a valid 16-digit Luhn card number", () => {
    const result = validateCardNumber(validCard);
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe(validCard);
  });

  it("accepts the same number with Persian digits and spaces", () => {
    const withSpaces = validCard.replace(/(\d{4})(?=\d)/g, "$1 ");
    const persian = normalizeDigitsToPersian(withSpaces);
    const result = validateCardNumber(persian);
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe(validCard);
  });

  it("rejects a number with the wrong length", () => {
    expect(validateCardNumber("1234567890123").valid).toBe(false);
  });

  it("rejects a number that fails the Luhn check", () => {
    const broken = validCard.slice(0, -1) + (validCard.at(-1) === "0" ? "1" : "0");
    expect(validateCardNumber(broken).valid).toBe(false);
  });
});

describe("validateIban", () => {
  const validIban = buildValidIban("IR", "0540102680020817909002");

  it("accepts a structurally valid Iranian IBAN", () => {
    const result = validateIban(validIban);
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe(validIban);
  });

  it("accepts the value without the IR prefix by adding it", () => {
    const result = validateIban(validIban.slice(2));
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe(validIban);
  });

  it("accepts Persian digits and spaces", () => {
    const withSpaces = validIban.replace(/(.{4})(?=.)/g, "$1 ");
    const persian = normalizeDigitsToPersian(withSpaces);
    const result = validateIban(persian);
    expect(result.valid).toBe(true);
    expect(result.normalized).toBe(validIban);
  });

  it("rejects the wrong length", () => {
    expect(validateIban("IR123").valid).toBe(false);
  });

  it("rejects a broken checksum", () => {
    const broken = validIban.slice(0, -1) + (validIban.at(-1) === "0" ? "1" : "0");
    expect(validateIban(broken).valid).toBe(false);
  });
});

const ASCII_TO_PERSIAN_DIGIT: Record<string, string> = {
  "0": "۰",
  "1": "۱",
  "2": "۲",
  "3": "۳",
  "4": "۴",
  "5": "۵",
  "6": "۶",
  "7": "۷",
  "8": "۸",
  "9": "۹"
};

function normalizeDigitsToPersian(input: string): string {
  return input.replace(/[0-9]/g, (digit) => ASCII_TO_PERSIAN_DIGIT[digit]);
}
