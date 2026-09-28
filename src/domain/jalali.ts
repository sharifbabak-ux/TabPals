/**
 * Pure Gregorian <-> Jalali (Solar Hijri) calendar conversion and helpers,
 * used by the custom Jalali date picker (docs/PLAN.md Stage 3A UI #4) and
 * anywhere month lengths / leap years / weekday order are needed.
 *
 * Built on `Intl`'s ICU "persian" calendar (the same source of truth
 * already used by src/domain/format.ts) rather than a hand-rolled leap-year
 * formula, so results always agree with the rest of the app. `Intl` is a
 * JS-global API, not DOM/IndexedDB/network access, so this stays pure per
 * CLAUDE.md.
 */

const PERSIAN_CALENDAR_ASCII_LOCALE = "en-US-u-ca-persian";

export interface JalaliDate {
  year: number;
  month: number;
  day: number;
}

export const PERSIAN_MONTH_NAMES: readonly string[] = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند"
];

/** Weekday short labels, Saturday-first (the Persian week's first day). */
export const PERSIAN_WEEKDAY_SHORT_LABELS: readonly string[] = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

function datePartsOf(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat(PERSIAN_CALENDAR_ASCII_LOCALE, {
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

/** Converts a Gregorian Date (read in local time) to its Jalali calendar equivalent. */
export function gregorianToJalali(date: Date): JalaliDate {
  return datePartsOf(date);
}

function sameJalaliDate(a: JalaliDate, b: JalaliDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * Converts a Jalali calendar date to the corresponding Gregorian Date (at
 * local midnight). Searches day-by-day from a safe estimate — Jalali years
 * span at most 366 days, so this always terminates quickly.
 */
export function jalaliToGregorian(year: number, month: number, day: number): Date {
  const target: JalaliDate = { year, month, day };
  const approxGregorianYear = year + 621;
  let cursor = new Date(approxGregorianYear - 1, 11, 1);
  cursor.setHours(0, 0, 0, 0);

  for (let i = 0; i < 800; i++) {
    if (sameJalaliDate(datePartsOf(cursor), target)) return cursor;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  throw new Error(`تاریخ شمسی نامعتبر است: ${year}/${month}/${day}`);
}

/** Number of days in a Jalali year: 366 for leap years, 365 otherwise. */
export function jalaliYearLength(year: number): number {
  const start = jalaliToGregorian(year, 1, 1);
  const nextStart = jalaliToGregorian(year + 1, 1, 1);
  return Math.round((nextStart.getTime() - start.getTime()) / 86400000);
}

export function isLeapJalaliYear(year: number): boolean {
  return jalaliYearLength(year) === 366;
}

/** Number of days in a given Jalali month (1-12). */
export function jalaliMonthLength(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  return isLeapJalaliYear(year) ? 30 : 29;
}

/** Weekday index for the Persian week, Saturday-first: 0=شنبه ... 6=جمعه. */
export function jalaliWeekdayIndex(date: Date): number {
  return (date.getDay() + 1) % 7;
}

export function todayJalali(): JalaliDate {
  return gregorianToJalali(new Date());
}
