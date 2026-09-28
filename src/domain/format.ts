/**
 * Persian (Jalali) date, time, and amount formatting.
 *
 * Every user-facing date/number in the app must go through these
 * functions rather than calling Intl directly, so formatting stays
 * consistent and testable in one place.
 */

const FA_CALENDAR_LOCALE = "fa-IR-u-ca-persian";
const FA_LOCALE = "fa-IR";

/** Formats a date as a Jalali "YYYY/MM/DD" string with Persian digits. */
export function formatJalaliDate(date: Date): string {
  return new Intl.DateTimeFormat(FA_CALENDAR_LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

/** Formats the Persian weekday name for a date (e.g. "دوشنبه"). */
export function formatWeekday(date: Date): string {
  return new Intl.DateTimeFormat(FA_CALENDAR_LOCALE, { weekday: "long" }).format(date);
}

/** Formats a 24-hour "HH:MM" time with Persian digits. */
export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat(FA_LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

/** Formats a full Jalali date + weekday + time, e.g. "دوشنبه ۱۴۰۴/۰۷/۰۶ ۱۴:۰۵". */
export function formatJalaliDateTime(date: Date): string {
  return `${formatWeekday(date)} ${formatJalaliDate(date)} ${formatTime(date)}`;
}

/**
 * Formats a monetary amount with Persian digits and Persian thousand
 * separators (e.g. 1234567 -> "۱٬۲۳۴٬۵۶۷"). Amounts are always whole
 * Toman/Rial units, so no decimal places are shown.
 */
export function formatAmount(amount: number): string {
  return new Intl.NumberFormat(FA_LOCALE, {
    maximumFractionDigits: 0
  }).format(amount);
}

const EN_TO_FA_DIGITS: Record<string, string> = {
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

/** Converts any ASCII digits in a string to Persian digits, leaving everything else untouched. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/[0-9]/g, (digit) => EN_TO_FA_DIGITS[digit]);
}
