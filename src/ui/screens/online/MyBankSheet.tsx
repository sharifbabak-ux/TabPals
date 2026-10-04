import { useEffect, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { onlineService } from "@/data/online/onlineService";
import { editableValue, isPendingKey, PENDING_KEY_TEXT } from "@/domain/encryptedDisplay";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { BankDetailsFields, validateBankDetails, type BankDetailsValue } from "@/ui/components/BankDetailsFields";
import { groupDigitsForDisplay } from "@/ui/components/BankDetailsFields";
import "./online.css";

interface MyBankSheetProps {
  open: boolean;
  eventId: string;
  onClose: () => void;
}

const EMPTY: BankDetailsValue = { cardNumber: "", iban: "", bankName: "", accountHolder: "" };

/** «اطلاعات بانکی من»: the member's own card/IBAN/bank/holder/phone, shared end-to-end encrypted with the treasurer and admins only. */
export function MyBankSheet({ open, eventId, onClose }: MyBankSheetProps) {
  const link = useLiveQuery(() => db.onlineLinks.get(eventId), [eventId]);
  const keyRow = useLiveQuery(async () => (await db.eventKeys.get(eventId)) ?? null, [eventId]);
  const person = useLiveQuery(async () => (link ? await db.persons.get(link.memberId) : undefined), [link?.memberId]);
  const [bank, setBank] = useState<BankDetailsValue>(EMPTY);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const personId = person?.id;
  useEffect(() => {
    if (!open || !person) return;
    setBank({
      cardNumber: person.cardNumber && !isPendingKey(person.cardNumber) ? groupDigitsForDisplay(person.cardNumber) : "",
      iban: editableValue(person.iban),
      bankName: editableValue(person.bankName),
      accountHolder: editableValue(person.accountHolder) || `${person.firstName} ${person.lastName}`.trim()
    });
    setPhone(editableValue(person.phone));
    setError(null);
    setSaved(false);
    // reset only when the sheet opens for a person
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, personId]);

  const locked = new Set<keyof BankDetailsValue>();
  if (person) {
    if (isPendingKey(person.cardNumber)) locked.add("cardNumber");
    if (isPendingKey(person.iban)) locked.add("iban");
    if (isPendingKey(person.bankName)) locked.add("bankName");
    if (isPendingKey(person.accountHolder)) locked.add("accountHolder");
  }
  const phoneLocked = isPendingKey(person?.phone);
  const validation = validateBankDetails(bank);
  const hasKey = Boolean(keyRow?.verified);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!validation.valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const ibanDigits = bank.iban.replace(/^IR/i, "").trim();
      await onlineService.saveMyProfile(eventId, {
        ...(locked.has("cardNumber") ? {} : { cardNumber: bank.cardNumber }),
        ...(locked.has("iban") ? {} : { iban: ibanDigits ? bank.iban : "" }),
        ...(locked.has("bankName") ? {} : { bankName: bank.bankName }),
        ...(locked.has("accountHolder") ? {} : { accountHolder: bank.accountHolder }),
        ...(phoneLocked ? {} : { phone })
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ذخیره ناموفق بود");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet open={open} title="اطلاعات بانکی من" onClose={onClose}>
      <form onSubmit={submit}>
        <p className="field__hint my-bank__privacy">
          این اطلاعات فقط روی دستگاه‌ها رمزگذاری می‌شود و تنها برای مسئول صندوق و مدیر ایونت قابل‌خواندن است؛ سرور و سایر اعضا هرگز آن را نمی‌بینند. مسئول صندوق برای واریز سهم شما از آن استفاده می‌کند. ذخیره‌ی آن اختیاری است.
        </p>
        {!hasKey && <p className="field__warning">{PENDING_KEY_TEXT} — تا رسیدن کلید، تغییرها روی همین دستگاه ذخیره می‌شود و بعد از دریافت کلید ارسال خواهد شد.</p>}
        <BankDetailsFields idPrefix="my-bank" value={bank} onChange={setBank} lockedFields={locked} lockedText={PENDING_KEY_TEXT} />
        <div className="field">
          <label htmlFor="my-bank-phone">شماره تماس</label>
          <input
            id="my-bank-phone"
            type="tel"
            autoComplete="off"
            disabled={phoneLocked}
            placeholder={phoneLocked ? PENDING_KEY_TEXT : undefined}
            value={phoneLocked ? "" : phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        {error && <p className="field__error">{error}</p>}
        {saved && <p className="field__hint">ذخیره شد.</p>}
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={onClose}>
            بستن
          </button>
          <button type="submit" className="form-actions__primary" disabled={!validation.valid || saving || !person}>
            ذخیره
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
