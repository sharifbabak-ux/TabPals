import { editableValue, isPendingKey } from "@/domain/encryptedDisplay";
import { useEffect, useState, type FormEvent } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { JalaliDatePicker } from "@/ui/components/JalaliDatePicker";
import { validateCardNumber, validateIban } from "@/domain/paymentValidation";
import type { Event, EventCurrency } from "@/data/types";
import type { EventInput } from "@/data/repositories/eventsRepository";

interface PersonOption {
  id: string;
  name: string;
  cardNumber?: string;
  iban?: string;
  bankName?: string;
  accountHolder?: string;
}

interface EventFormSheetProps {
  open: boolean;
  event?: Event;
  /** True when editing a closed event — mutes the treasurer fields (see CLAUDE.md). */
  closed?: boolean;
  /**
   * Who the treasurer can be picked from. When creating a new event there
   * are no members yet, so the full people directory is offered instead —
   * the caller enrolls the chosen treasurer as the event's first member.
   */
  treasurerOptions: PersonOption[];
  onClose: () => void;
  onSubmit: (input: EventInput) => Promise<void>;
  /** Present only when editing — opens the archive/restore confirmation. */
  onArchiveRequest?: () => void;
}

const CURRENCIES: EventCurrency[] = ["تومان", "ریال"];

/** Create/edit event sheet. Dates are optional and stored as ISO date strings; Jalali display happens wherever the date is shown. */
export function EventFormSheet({ open, event, closed, treasurerOptions, onClose, onSubmit, onArchiveRequest }: EventFormSheetProps) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState<EventCurrency>("تومان");
  const [treasurerPersonId, setTreasurerPersonId] = useState("");
  const [treasurerCardNumber, setTreasurerCardNumber] = useState("");
  const [treasurerIban, setTreasurerIban] = useState("");
  const [treasurerBankName, setTreasurerBankName] = useState("");
  const [treasurerAccountHolder, setTreasurerAccountHolder] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(event?.title ?? "");
      setStartDate(event?.startDate ?? "");
      setEndDate(event?.endDate ?? "");
      setDescription(event?.description ?? "");
      setCurrency(event?.currency ?? "تومان");
      setTreasurerPersonId(event?.treasurerPersonId ?? "");
      setTreasurerCardNumber(editableValue(event?.treasurerCardNumber));
      setTreasurerIban(editableValue(event?.treasurerIban));
      setTreasurerBankName(editableValue(event?.treasurerBankName));
      setTreasurerAccountHolder(editableValue(event?.treasurerAccountHolder));
      setSubmitError(null);
    }
  }, [open, event]);

  /** Choosing a treasurer prefills all four bank fields from their saved person record (docs/PLAN.md Stage 3B.1); the fields stay editable per event afterward. */
  function handleTreasurerSelect(personId: string) {
    setTreasurerPersonId(personId);
    const person = treasurerOptions.find((p) => p.id === personId);
    if (!person) return;
    setTreasurerCardNumber(person.cardNumber ?? "");
    setTreasurerIban(person.iban ?? "");
    setTreasurerBankName(person.bankName ?? "");
    setTreasurerAccountHolder(person.accountHolder ?? person.name);
  }

  // Once a treasurer is set, changing it on a closed event requires reopening — but SETTING one
  // for the first time stays allowed while closed, so a statement can be issued (docs/PLAN.md Stage 3B).
  const treasurerLocked = Boolean(event) && Boolean(closed) && Boolean(event?.treasurerPersonId);
  const cardValidation = treasurerCardNumber.trim() ? validateCardNumber(treasurerCardNumber) : null;
  const ibanValidation = treasurerIban.trim() ? validateIban(treasurerIban) : null;

  const valid =
    title.trim().length > 0 &&
    treasurerPersonId !== "" &&
    (cardValidation?.valid ?? true) &&
    (ibanValidation?.valid ?? true);

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
        currency,
        treasurerPersonId,
        // values still encrypted (key not received yet) are left untouched
        ...(isPendingKey(event?.treasurerCardNumber) ? {} : { treasurerCardNumber }),
        ...(isPendingKey(event?.treasurerIban) ? {} : { treasurerIban }),
        ...(isPendingKey(event?.treasurerBankName) ? {} : { treasurerBankName }),
        ...(isPendingKey(event?.treasurerAccountHolder) ? {} : { treasurerAccountHolder })
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
          <JalaliDatePicker id="event-start" value={startDate} onChange={setStartDate} />
        </div>
        <div className="field">
          <label htmlFor="event-end">تاریخ پایان (اختیاری)</label>
          <JalaliDatePicker id="event-end" value={endDate} onChange={setEndDate} />
        </div>
        <div className="field">
          <label htmlFor="event-currency">واحد پول</label>
          <select id="event-currency" value={currency} onChange={(formEvent) => setCurrency(formEvent.target.value as EventCurrency)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="event-description">توضیحات (اختیاری)</label>
          <input id="event-description" value={description} onChange={(formEvent) => setDescription(formEvent.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="event-treasurer">مسئول صندوق</label>
          <select
            id="event-treasurer"
            value={treasurerPersonId}
            disabled={treasurerLocked}
            onChange={(formEvent) => handleTreasurerSelect(formEvent.target.value)}
          >
            <option value="">انتخاب کنید</option>
            {treasurerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          {!event && <p className="field__hint">شخص انتخاب‌شده به‌عنوان اولین عضو ایونت هم اضافه می‌شود.</p>}
        </div>
        <div className="field">
          <label htmlFor="event-treasurer-card">شماره کارت مسئول صندوق (اختیاری)</label>
          <input
            id="event-treasurer-card"
            dir="ltr"
            disabled={treasurerLocked}
            value={treasurerCardNumber}
            onChange={(formEvent) => setTreasurerCardNumber(formEvent.target.value)}
          />
          {cardValidation && !cardValidation.valid && <span className="field__error">{cardValidation.error}</span>}
        </div>
        <div className="field">
          <label htmlFor="event-treasurer-iban">شماره شبا مسئول صندوق (اختیاری)</label>
          <input
            id="event-treasurer-iban"
            dir="ltr"
            disabled={treasurerLocked}
            value={treasurerIban}
            onChange={(formEvent) => setTreasurerIban(formEvent.target.value)}
          />
          {ibanValidation && !ibanValidation.valid && <span className="field__error">{ibanValidation.error}</span>}
        </div>
        <div className="field">
          <label htmlFor="event-treasurer-bank">نام بانک مسئول صندوق (اختیاری)</label>
          <input
            id="event-treasurer-bank"
            disabled={treasurerLocked}
            value={treasurerBankName}
            onChange={(formEvent) => setTreasurerBankName(formEvent.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="event-treasurer-holder">نام صاحب حساب (اختیاری)</label>
          <input
            id="event-treasurer-holder"
            disabled={treasurerLocked}
            value={treasurerAccountHolder}
            onChange={(formEvent) => setTreasurerAccountHolder(formEvent.target.value)}
          />
        </div>
        {treasurerLocked && (
          <p className="field__hint">این ایونت پایان‌یافته است؛ برای تغییر مسئول صندوق، ابتدا آن را بازگشایی کنید.</p>
        )}

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
