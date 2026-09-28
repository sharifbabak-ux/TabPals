/**
 * Normalizes a Persian/Arabic display name for duplicate detection (see
 * CLAUDE.md Data rules and the اشخاص/گروه‌ها duplicate-name block in
 * docs/PLAN.md #1). Two names that normalize to the same string are
 * considered the same name.
 */

const ARABIC_TO_PERSIAN_LETTERS: Record<string, string> = {
  "ي": "ی", // ARABIC LETTER YEH -> PERSIAN YEH
  "ك": "ک" // ARABIC LETTER KAF -> PERSIAN KEHEH
};

// Arabic combining diacritics (tashkeel): fatha, damma, kasra, sukun, shadda, tanwin, etc.
const DIACRITICS_REGEX = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g;

const ZERO_WIDTH_NON_JOINER_REGEX = /‌/g;

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

/**
 * Normalizes a name for comparison: Arabic ي/ك -> Persian ی/ک, strips
 * ZWNJ and Arabic diacritics, converts Persian/Arabic digits to ASCII,
 * trims, collapses internal whitespace, and lowercases.
 */
export function normalizeName(name: string): string {
  let result = name;
  result = result.replace(ZERO_WIDTH_NON_JOINER_REGEX, "");
  result = result.replace(/[يك]/g, (letter) => ARABIC_TO_PERSIAN_LETTERS[letter]);
  result = result.replace(DIACRITICS_REGEX, "");
  result = result.replace(/[۰-۹٠-٩]/g, (digit) => DIGIT_TO_ASCII[digit]);
  result = result.trim().replace(/\s+/g, " ");
  return result.toLowerCase();
}
