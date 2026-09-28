import { useEffect, useState } from "react";
import {
  PERSIAN_MONTH_NAMES,
  PERSIAN_WEEKDAY_SHORT_LABELS,
  gregorianToJalali,
  jalaliMonthLength,
  jalaliToGregorian,
  jalaliWeekdayIndex,
  todayJalali,
  type JalaliDate as JalaliDateValue
} from "@/domain/jalali";
import { formatJalaliDate, toPersianDigits } from "@/domain/format";
import { BottomSheet } from "./BottomSheet";
import "./JalaliDatePicker.css";

interface JalaliDatePickerProps {
  id?: string;
  /** ISO date "YYYY-MM-DD", or "" for no selection. */
  value: string;
  onChange: (isoDate: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIsoDate(iso: string): JalaliDateValue | null {
  if (!iso) return null;
  return gregorianToJalali(new Date(`${iso}T00:00:00`));
}

/** Custom Jalali month-grid date picker (docs/PLAN.md Stage 3A UI #4) — replaces native <input type="date">. */
export function JalaliDatePicker({ id, value, onChange, placeholder = "انتخاب تاریخ", disabled }: JalaliDatePickerProps) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDate(value);
  const [viewYear, setViewYear] = useState(() => (selected ?? todayJalali()).year);
  const [viewMonth, setViewMonth] = useState(() => (selected ?? todayJalali()).month);

  useEffect(() => {
    if (!open) return;
    const anchor = selected ?? todayJalali();
    setViewYear(anchor.year);
    setViewMonth(anchor.month);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function goToPreviousMonth() {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function selectDay(day: number) {
    onChange(toIsoDate(jalaliToGregorian(viewYear, viewMonth, day)));
    setOpen(false);
  }

  function selectToday() {
    onChange(toIsoDate(new Date()));
    setOpen(false);
  }

  const monthLength = jalaliMonthLength(viewYear, viewMonth);
  const leadingBlanks = jalaliWeekdayIndex(jalaliToGregorian(viewYear, viewMonth, 1));
  const days = Array.from({ length: monthLength }, (_, i) => i + 1);

  return (
    <>
      <button
        type="button"
        id={id}
        className="jalali-date-picker__trigger"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {value ? (
          <span className="jalali-date-picker__value">{formatJalaliDate(new Date(`${value}T00:00:00`))}</span>
        ) : (
          <span className="jalali-date-picker__placeholder">{placeholder}</span>
        )}
      </button>

      <BottomSheet
        open={open}
        title={`${PERSIAN_MONTH_NAMES[viewMonth - 1]} ${toPersianDigits(viewYear)}`}
        onClose={() => setOpen(false)}
      >
        <div className="jalali-picker">
          <div className="jalali-picker__nav">
            <button type="button" onClick={goToNextMonth}>
              ماه بعد
            </button>
            <button type="button" className="jalali-picker__today" onClick={selectToday}>
              امروز
            </button>
            <button type="button" onClick={goToPreviousMonth}>
              ماه قبل
            </button>
          </div>

          <div className="jalali-picker__weekdays">
            {PERSIAN_WEEKDAY_SHORT_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="jalali-picker__grid">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {days.map((day) => {
              const isSelected = selected?.year === viewYear && selected?.month === viewMonth && selected?.day === day;
              return (
                <button
                  type="button"
                  key={day}
                  className={`jalali-picker__day${isSelected ? " jalali-picker__day--selected" : ""}`}
                  onClick={() => selectDay(day)}
                >
                  {toPersianDigits(day)}
                </button>
              );
            })}
          </div>
        </div>
      </BottomSheet>
    </>
  );
}
