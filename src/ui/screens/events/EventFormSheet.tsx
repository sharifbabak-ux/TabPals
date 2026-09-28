import { useEffect, useState, type FormEvent } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import type { EventInput } from "@/data/repositories/eventsRepository";

interface EventFormSheetProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: EventInput) => Promise<void>;
}

/** Create-event sheet. Dates are optional and stored as ISO date strings; Jalali display happens wherever the date is shown. */
export function EventFormSheet({ open, onClose, onSubmit }: EventFormSheetProps) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle("");
      setStartDate("");
      setEndDate("");
      setDescription("");
    }
  }, [open]);

  const valid = title.trim().length > 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        title,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        description
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} title="ایونت جدید" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="event-title">عنوان</label>
          <input id="event-title" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="event-start">تاریخ شروع (اختیاری)</label>
          <input id="event-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="event-end">تاریخ پایان (اختیاری)</label>
          <input id="event-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="event-description">توضیحات (اختیاری)</label>
          <input id="event-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={onClose}>
            انصراف
          </button>
          <button type="submit" className="form-actions__primary" disabled={!valid || submitting}>
            ایجاد
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
