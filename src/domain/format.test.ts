import { describe, expect, it } from "vitest";
import {
  formatAmount,
  formatJalaliDate,
  formatJalaliDateTime,
  formatTime,
  formatWeekday,
  toPersianDigits
} from "./format";

// 2025-09-28T14:05:00 local time = 1404/07/06 (Sunday) in the Jalali calendar.
const SAMPLE_DATE = new Date(2025, 8, 28, 14, 5, 0);

describe("formatJalaliDate", () => {
  it("formats a date as Jalali YYYY/MM/DD with Persian digits", () => {
    expect(formatJalaliDate(SAMPLE_DATE)).toBe("۱۴۰۴/۰۷/۰۶");
  });
});

describe("formatWeekday", () => {
  it("formats the Persian weekday name", () => {
    expect(formatWeekday(SAMPLE_DATE)).toBe("یکشنبه");
  });
});

describe("formatTime", () => {
  it("formats 24-hour time with Persian digits", () => {
    expect(formatTime(SAMPLE_DATE)).toBe("۱۴:۰۵");
  });

  it("zero-pads single-digit hours and minutes", () => {
    const early = new Date(2025, 8, 28, 4, 5, 0);
    expect(formatTime(early)).toBe("۰۴:۰۵");
  });
});

describe("formatJalaliDateTime", () => {
  it("combines weekday, date, and time", () => {
    expect(formatJalaliDateTime(SAMPLE_DATE)).toBe("یکشنبه ۱۴۰۴/۰۷/۰۶ ۱۴:۰۵");
  });
});

describe("formatAmount", () => {
  it("adds Persian thousand separators and Persian digits", () => {
    expect(formatAmount(1234567)).toBe("۱٬۲۳۴٬۵۶۷");
  });

  it("formats small amounts without separators", () => {
    expect(formatAmount(500)).toBe("۵۰۰");
  });

  it("formats zero", () => {
    expect(formatAmount(0)).toBe("۰");
  });

  it("rounds to whole units", () => {
    expect(formatAmount(1000.7)).toBe("۱٬۰۰۱");
  });
});

describe("toPersianDigits", () => {
  it("converts ASCII digits to Persian digits", () => {
    expect(toPersianDigits("v1.0.3")).toBe("v۱.۰.۳");
  });

  it("leaves non-digit characters untouched", () => {
    expect(toPersianDigits("abc")).toBe("abc");
  });

  it("accepts numbers", () => {
    expect(toPersianDigits(2025)).toBe("۲۰۲۵");
  });
});
