/**
 * Iranian card number and IBAN (شبا) validation for the event treasurer's
 * payment details (docs/PLAN.md Stage 3A). Pure: accepts Persian/Arabic
 * digits and spaces, and returns a normalized (ASCII, unspaced) value on
 * success so the repository always stores a canonical form.
 */

const DIGIT_TO_ASCII: Record<string, string> = {
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9"
};

/** Converts any Persian/Arabic digits in a string to ASCII digits. */
export function normalizeDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (digit) => DIGIT_TO_ASCII[digit]);
}

export interface PaymentFieldValidation {
  valid: boolean;
  error?: string;
  /** Canonical ASCII form, present only when valid. */
  normalized?: string;
}

function luhnCheck(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Validates an Iranian bank card number: exactly 16 digits, passing the Luhn checksum. */
export function validateCardNumber(input: string): PaymentFieldValidation {
  const stripped = normalizeDigits(input).replace(/[\s-]/g, "");
  if (!/^\d{16}$/.test(stripped)) {
    return { valid: false, error: "شماره کارت باید ۱۶ رقم باشد" };
  }
  if (!luhnCheck(stripped)) {
    return { valid: false, error: "شماره کارت نامعتبر است" };
  }
  return { valid: true, normalized: stripped };
}

/** ISO 7064 MOD 97-10 check used by IBAN: valid iff the rearranged numeric string mod 97 === 1. */
function iso7064Mod97IsValid(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digitChar of numeric) {
    remainder = (remainder * 10 + Number(digitChar)) % 97;
  }
  return remainder === 1;
}

/** Validates an Iranian IBAN (شبا): "IR" followed by 24 digits, passing ISO 7064 mod-97. */
export function validateIban(input: string): PaymentFieldValidation {
  const stripped = normalizeDigits(input).replace(/\s/g, "").toUpperCase();
  const withPrefix = stripped.startsWith("IR") ? stripped : `IR${stripped}`;
  if (!/^IR\d{24}$/.test(withPrefix)) {
    return { valid: false, error: "شماره شبا باید به‌صورت IR و ۲۴ رقم باشد" };
  }
  if (!iso7064Mod97IsValid(withPrefix)) {
    return { valid: false, error: "شماره شبا نامعتبر است" };
  }
  return { valid: true, normalized: withPrefix };
}

/** Groups a normalized 16-digit card number as "1234 5678 9012 3456" for display on statements. */
export function formatCardNumberGrouped(normalizedCardNumber: string): string {
  return normalizedCardNumber.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Groups a normalized "IR" + 24-digit IBAN as "IR12 3456 7890 1234 5678 9012 34" for display on statements. */
export function formatIbanGrouped(normalizedIban: string): string {
  return normalizedIban.replace(/(.{4})(?=.)/g, "$1 ");
}
