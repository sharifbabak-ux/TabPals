import { useEffect, useState, type FormEvent } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import type { Event } from "@/data/types";
import type { EventInput } from "@/data/repositories/eventsRepository";

interface EventFormSheetProps {
  open: boolean;
  event?: Event;
  onClose: () => void;
  onSubmit: (input: EventInput) => Promise<void>;
  /** Present only when editing — opens the archive/restore confirmation. */
  onArchiveRequest?: () => void;
}

/** Create/edit event sheet. Dates are optional and stored as ISO date strings; Jalali display happens wherever the date is shown. */
export function EventFormSheet({ open, event, onClose, onSubmit, onArchiveRequest }: EventFormSheetProps) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [currencyLabel, setCurrencyLabel] = useState("تومان");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(event?.title ?? "");
      setStartDate(event?.startDate ?? "");
      setEndDate(event?.endDate ?? "");
      setDescription(event?.description ?? "");
      setCurrencyLabel(event?.currencyLabel ?? "تومان");
      setSubmitError(null);
    }
  }, [open, event]);

  const valid = title.trim().length > 0;

  async function handleSubmit(formEvent: FormEvent) {
    formEvent.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        title,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        description,
        currencyLabel
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} title={event ? "ویرایش ایونت" : "ایونت جدید"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="event-title">عنوان</label>
          <input id="event-title" value={title} onChange={(formEvent) => setTitle(formEvent.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="event-start">تاریخ شروع (اختیاری)</label>
          <input id="event-start" type="date" value={startDate} onChange={(formEvent) => setStartDate(formEvent.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="event-end">تاریخ پایان (اختیاری)</label>
          <input id="event-end" type="date" value={endDate} onChange={(formEvent) => setEndDate(formEvent.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="event-currency">واحد پول</label>
          <input id="event-currency" value={currencyLabel} onChange={(formEvent) => setCurrencyLabel(formEvent.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="event-description">توضیحات (اختیاری)</label>
          <input id="event-description" value={description} onChange={(formEvent) => setDescription(formEvent.target.value)} />
        </div>
        {submitError && <p className="field__error">{submitError}</p>}
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={onClose}>
            انصراف
          </button>
          <button type="submit" className="form-actions__primary" disabled={!valid || submitting}>
            {event ? "ذخیره" : "ایجاد"}
          </button>
        </div>

        {event && onArchiveRequest && (
          <div className="sheet__danger-zone">
            <button type="button" className="sheet__archive-button" onClick={onArchiveRequest}>
              {event.archived ? "بازگردانی از آرشیو" : "آرشیو کردن این ایونت"}
            </button>
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
