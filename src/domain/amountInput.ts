/**
 * Pure parsing for the amount input field (docs/PLAN.md #4, Stage 2 task
 * description part C — "Amount input parsing"). Accepts Persian, Arabic,
 * or English digits and any common thousand separator, and returns a
 * whole-unit integer (amounts are always integers per CLAUDE.md).
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

// Thousand separators to strip: ASCII comma, Arabic comma (،), Arabic thousands
// separator (٬ U+066C), and plain spaces (used as a separator in some locales).
const SEPARATORS_REGEX = /[,،٬\s]/g;

/** Parses free-typed amount text into a whole-unit integer. Returns 0 for empty/invalid input. */
export function parseAmountInput(input: string): number {
  if (!input) return 0;

  let normalized = input.replace(/[۰-۹٠-٩]/g, (digit) => DIGIT_TO_ASCII[digit]);
  normalized = normalized.replace(SEPARATORS_REGEX, "");
  normalized = normalized.trim();

  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) return 0;

  const value = Number(normalized);
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}
