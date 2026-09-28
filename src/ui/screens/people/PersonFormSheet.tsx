import { useEffect, useState, type FormEvent } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { validatePersonName } from "@/domain/personValidation";
import type { Person } from "@/data/types";
import type { PersonInput } from "@/data/repositories/personsRepository";

interface PersonFormSheetProps {
  open: boolean;
  person?: Person;
  /** Names of other active persons, used for the duplicate-name block. */
  existingNames: string[];
  onClose: () => void;
  onSubmit: (input: PersonInput) => Promise<void>;
  /** Present only when editing — opens the archive/restore confirmation. */
  onArchiveRequest?: () => void;
}

export function PersonFormSheet({ open, person, existingNames, onClose, onSubmit, onArchiveRequest }: PersonFormSheetProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(person?.name ?? "");
      setPhone(person?.phone ?? "");
      setNote(person?.note ?? "");
      setSubmitError(null);
    }
  }, [open, person]);

  const validation = validatePersonName(name, existingNames);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!validation.valid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({ name, phone, note });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} title={person ? "ویرایش شخص" : "شخص جدید"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="person-name">نام</label>
          <input id="person-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          {validation.error && <span className="field__error">{validation.error}</span>}
        </div>
        <div className="field">
          <label htmlFor="person-phone">شماره تماس (اختیاری)</label>
          <input id="person-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="person-note">یادداشت (اختیاری)</label>
          <input id="person-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>
        {submitError && <p className="field__error">{submitError}</p>}
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={onClose}>
            انصراف
          </button>
          <button type="submit" className="form-actions__primary" disabled={!validation.valid || submitting}>
            ذخیره
          </button>
        </div>

        {person && onArchiveRequest && (
          <div className="sheet__danger-zone">
            <button type="button" className="sheet__archive-button" onClick={onArchiveRequest}>
              {person.archived ? "بازگردانی از آرشیو" : "آرشیو کردن این شخص"}
            </button>
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
