import { describe, expect, it } from "vitest";
import {
  PERSIAN_MONTH_NAMES,
  PERSIAN_WEEKDAY_SHORT_LABELS,
  gregorianToJalali,
  isLeapJalaliYear,
  jalaliMonthLength,
  jalaliToGregorian,
  jalaliWeekdayIndex,
  jalaliYearLength
} from "./jalali";

// Same fixture as src/domain/format.test.ts: 2025-09-28 (Sunday) = 1404/07/06.
const SAMPLE_DATE = new Date(2025, 8, 28, 14, 5, 0);

describe("gregorianToJalali", () => {
  it("matches the known reference date", () => {
    expect(gregorianToJalali(SAMPLE_DATE)).toEqual({ year: 1404, month: 7, day: 6 });
  });
});

describe("jalaliToGregorian", () => {
  it("round-trips the known reference date", () => {
    const result = jalaliToGregorian(1404, 7, 6);
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(8);
    expect(result.getDate()).toBe(28);
  });

  it("round-trips the first day of a Jalali year (Nowruz)", () => {
    const back = gregorianToJalali(jalaliToGregorian(1404, 1, 1));
    expect(back).toEqual({ year: 1404, month: 1, day: 1 });
  });

  it("round-trips the last day of a Jalali year", () => {
    const length = jalaliMonthLength(1403, 12);
    const back = gregorianToJalali(jalaliToGregorian(1403, 12, length));
    expect(back).toEqual({ year: 1403, month: 12, day: length });
  });
});

describe("round trip across a range of dates", () => {
  it("converts Gregorian -> Jalali -> Gregorian back to the same day", () => {
    for (let offset = 0; offset < 400; offset += 17) {
      const date = new Date(2024, 0, 1 + offset);
      const jalali = gregorianToJalali(date);
      const back = jalaliToGregorian(jalali.year, jalali.month, jalali.day);
      expect(back.getFullYear()).toBe(date.getFullYear());
      expect(back.getMonth()).toBe(date.getMonth());
      expect(back.getDate()).toBe(date.getDate());
    }
  });
});

describe("jalaliMonthLength / isLeapJalaliYear", () => {
  it("gives 31 days for the first 6 months", () => {
    for (let m = 1; m <= 6; m++) expect(jalaliMonthLength(1404, m)).toBe(31);
  });

  it("gives 30 days for months 7-11", () => {
    for (let m = 7; m <= 11; m++) expect(jalaliMonthLength(1404, m)).toBe(30);
  });

  it("esfand length agrees with isLeapJalaliYear and the year's total day count", () => {
    for (const year of [1401, 1402, 1403, 1404, 1405]) {
      const esfandLength = jalaliMonthLength(year, 12);
      expect(esfandLength === 30 || esfandLength === 29).toBe(true);
      expect(isLeapJalaliYear(year)).toBe(esfandLength === 30);

      const monthLengths = Array.from({ length: 12 }, (_, i) => jalaliMonthLength(year, i + 1));
      const total = monthLengths.reduce((a, b) => a + b, 0);
      expect(total).toBe(jalaliYearLength(year));
      expect(total === 365 || total === 366).toBe(true);
    }
  });
});

describe("jalaliWeekdayIndex", () => {
  it("gives Saturday=0 through Friday=6, matching the known Sunday reference date", () => {
    expect(jalaliWeekdayIndex(SAMPLE_DATE)).toBe(1);
    expect(jalaliWeekdayIndex(new Date(2025, 8, 27))).toBe(0); // Saturday
    expect(jalaliWeekdayIndex(new Date(2025, 9, 3))).toBe(6); // Friday
  });
});

describe("static data", () => {
  it("has 12 month names", () => {
    expect(PERSIAN_MONTH_NAMES).toHaveLength(12);
  });

  it("has 7 weekday short labels starting with شنبه", () => {
    expect(PERSIAN_WEEKDAY_SHORT_LABELS).toHaveLength(7);
    expect(PERSIAN_WEEKDAY_SHORT_LABELS[0]).toBe("ش");
  });
});
