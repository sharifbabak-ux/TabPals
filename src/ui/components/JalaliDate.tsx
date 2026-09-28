import { formatJalaliDate, formatTime, formatWeekday } from "@/domain/format";
import "./JalaliDate.css";

interface JalaliDateProps {
  date: Date;
  /** Prefixes the Persian weekday name, e.g. "دوشنبه ۱۴۰۵/۰۷/۰۶". */
  weekday?: boolean;
  /** Appends the 24-hour time. */
  time?: boolean;
}

/**
 * Displays a Jalali date with its digits inside an LTR bidi isolate, so
 * the year/month/day always read left-to-right even inside Persian RTL
 * text (docs/PLAN.md Stage 3A domain #2).
 */
export function JalaliDate({ date, weekday = false, time = false }: JalaliDateProps) {
  return (
    <span className="jalali-date">
      {weekday && <>{formatWeekday(date)} </>}
      <span className="jalali-date__numeric">{formatJalaliDate(date)}</span>
      {time && <> {formatTime(date)}</>}
    </span>
  );
}
