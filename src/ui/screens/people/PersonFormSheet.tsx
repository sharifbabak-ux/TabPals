import { useEffect, useState, type FormEvent } from "react";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { Avatar } from "@/ui/components/Avatar";
import { detectBankFromCardNumber, detectBankFromIban } from "@/domain/bankDetection";
import { validateCardNumber, validateIban } from "@/domain/paymentValidation";
import { validatePersonName, type PersonNameCandidate } from "@/domain/personValidation";
import { imageService } from "@/platform";
import { editableValue, isPendingKey, PENDING_KEY_TEXT } from "@/domain/encryptedDisplay";
import { MaskedValue } from "@/ui/components/MaskedValue";
import type { Person } from "@/data/types";
import type { PersonInput } from "@/data/repositories/personsRepository";

interface PersonFormSheetProps {
  open: boolean;
  person?: Person;
  /** First/last names of other active persons, used for the duplicate-name block. */
  existingNames: PersonNameCandidate[];
  onClose: () => void;
  onSubmit: (input: PersonInput) => Promise<void>;
  /** Present only when editing — opens the archive/restore confirmation. */
  onArchiveRequest?: () => void;
  /**
   * Present only when editing an ARCHIVED person: the events (if any) that
   * still reference them, so "حذف دائمی" can be disabled with an
   * explanation instead of failing silently (docs/PLAN.md Stage 3B.1).
   * `undefined` while still loading.
   */
  referencingEvents?: { eventId: string; title: string }[];
  onPermanentDeleteRequest?: () => void;
}

/** Groups digits into 4-character chunks for live display while typing (card number), without enforcing a final length. */
function groupDigitsForDisplay(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

function ibanWithPrefix(value: string): string {
  const stripped = value.replace(/[^\dIRir۰-۹٠-٩]/g, "").toUpperCase();
  const withoutPrefix = stripped.startsWith("IR") ? stripped.slice(2) : stripped;
  return `IR${withoutPrefix}`;
}

export function PersonFormSheet({
  open,
  person,
  existingNames,
  onClose,
  onSubmit,
  onArchiveRequest,
  referencingEvents,
  onPermanentDeleteRequest
}: PersonFormSheetProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  /** undefined = keep existing photo unchanged, null = remove it, Blob = newly picked. */
  const [photo, setPhoto] = useState<Blob | null | undefined>(undefined);
  const [pickingPhoto, setPickingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [iban, setIban] = useState("");
  const [bankName, setBankName] = useState("");
  const [bankNameTouched, setBankNameTouched] = useState(false);
  const [accountHolder, setAccountHolder] = useState("");
  const [accountHolderTouched, setAccountHolderTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFirstName(person?.firstName ?? "");
      setLastName(person?.lastName ?? "");
      setPhone(editableValue(person?.phone));
      setNote(person?.note ?? "");
      setPhoto(undefined);
      setPhotoError(null);
      setCardNumber(person?.cardNumber && !isPendingKey(person.cardNumber) ? groupDigitsForDisplay(person.cardNumber) : "");
      setIban(editableValue(person?.iban));
      setBankName(editableValue(person?.bankName));
      setBankNameTouched(Boolean(person?.bankName));
      setAccountHolder(editableValue(person?.accountHolder) || `${person?.firstName ?? ""} ${person?.lastName ?? ""}`.trim());
      setAccountHolderTouched(Boolean(person?.accountHolder));
      // Saved card/IBAN stay masked (tap to reveal) until the user opens the section to edit.
      setBankOpen(false);
      setSubmitError(null);
    }
  }, [open, person]);

  // Keep the account holder synced to the name fields until the user edits it themselves.
  useEffect(() => {
    if (!accountHolderTouched) setAccountHolder(`${firstName} ${lastName}`.trim());
  }, [firstName, lastName, accountHolderTouched]);

  // Auto-suggest the bank name from the card/IBAN, but never overwrite a name the user typed (docs/PLAN.md Stage 3B.1).
  useEffect(() => {
    if (bankNameTouched) return;
    const suggestion = detectBankFromCardNumber(cardNumber) ?? (iban ? detectBankFromIban(iban) : null);
    if (suggestion) setBankName(suggestion);
  }, [cardNumber, iban, bankNameTouched]);

  const nameValidation = validatePersonName(firstName, lastName, existingNames);
  const cardValidation = cardNumber.trim() ? validateCardNumber(cardNumber) : null;
  const ibanDigits = iban.replace(/^IR/i, "").trim();
  const ibanValidation = ibanDigits ? validateIban(iban) : null;
  const bankFieldsValid = (cardValidation?.valid ?? true) && (ibanValidation?.valid ?? true);
  const valid = nameValidation.valid && bankFieldsValid;
  /** Values that arrived encrypted and are still waiting for the event key: shown with the lock marker, never overwritten. */
  const lockedFields = {
    phone: isPendingKey(person?.phone),
    cardNumber: isPendingKey(person?.cardNumber),
    iban: isPendingKey(person?.iban),
    bankName: isPendingKey(person?.bankName),
    accountHolder: isPendingKey(person?.accountHolder)
  };
  const previewPhoto = photo === undefined ? person?.photo : photo === null ? undefined : photo;

  async function pickPhoto(source: "camera" | "gallery") {
    setPickingPhoto(true);
    setPhotoError(null);
    try {
      const blob = await imageService.pickSquarePhoto(source);
      if (blob) setPhoto(blob);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : "خطایی رخ داد");
    } finally {
      setPickingPhoto(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        firstName,
        lastName,
        ...(lockedFields.phone ? {} : { phone }),
        note,
        photo,
        ...(lockedFields.cardNumber ? {} : { cardNumber }),
        ...(lockedFields.iban ? {} : { iban: ibanDigits ? iban : "" }),
        ...(lockedFields.bankName ? {} : { bankName }),
        ...(lockedFields.accountHolder ? {} : { accountHolder })
      });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "خطایی رخ داد");
    } finally {
      setSubmitting(false);
    }
  }

  const permanentDeleteBlockedReason =
    referencingEvents && referencingEvents.length > 0
      ? `این شخص در ایونت‌های زیر استفاده شده و بهتر است آرشیو باقی بماند: ${referencingEvents.map((e) => e.title).join("، ")}`
      : null;

  return (
    <BottomSheet open={open} title={person ? "ویرایش شخص" : "شخص جدید"} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="person-photo-field">
          <Avatar id={person?.id ?? "new-person"} name={`${firstName} ${lastName}`.trim() || "؟"} photo={previewPhoto} size={72} />
          <div className="person-photo-field__actions">
            <button type="button" disabled={pickingPhoto} onClick={() => pickPhoto("camera")}>
              دوربین
            </button>
            <button type="button" disabled={pickingPhoto} onClick={() => pickPhoto("gallery")}>
              گالری
            </button>
            {previewPhoto && (
              <button type="button" className="person-photo-field__remove" onClick={() => setPhoto(null)}>
                حذف عکس
              </button>
            )}
          </div>
        </div>
        {photoError && <p className="field__error">{photoError}</p>}

        <div className="field">
          <label htmlFor="person-first-name">نام</label>
          <input id="person-first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="person-last-name">نام خانوادگی</label>
          <input id="person-last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} />
          {nameValidation.error && <span className="field__error">{nameValidation.error}</span>}
        </div>
        <div className="field">
          <label htmlFor="person-phone">شماره تماس (اختیاری)</label>
          <input
            id="person-phone"
            type="tel"
            disabled={lockedFields.phone}
            placeholder={lockedFields.phone ? PENDING_KEY_TEXT : undefined}
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="person-note">یادداشت (اختیاری)</label>
          <input id="person-note" value={note} onChange={(event) => setNote(event.target.value)} />
        </div>

        <button type="button" className="collapsible-toggle" onClick={() => setBankOpen((v) => !v)} aria-expanded={bankOpen}>
          اطلاعات بانکی (اختیاری) {bankOpen ? "▲" : "▼"}
        </button>
        {!bankOpen && person && (person.cardNumber || person.iban) && (
          <div className="person-bank-summary">
            {person.cardNumber && (
              <div>
                <MaskedValue kind="card" value={person.cardNumber} />
              </div>
            )}
            {person.iban && (
              <div>
                <MaskedValue kind="iban" value={person.iban} />
              </div>
            )}
          </div>
        )}
        {bankOpen && (
          <div className="collapsible-body">
            <div className="field">
              <label htmlFor="person-card">شماره کارت</label>
              <input
                id="person-card"
                disabled={lockedFields.cardNumber}
                placeholder={lockedFields.cardNumber ? PENDING_KEY_TEXT : undefined}
                dir="ltr"
                inputMode="numeric"
                value={cardNumber}
                onChange={(event) => setCardNumber(groupDigitsForDisplay(event.target.value))}
              />
              {cardValidation && !cardValidation.valid && <span className="field__error">{cardValidation.error}</span>}
            </div>
            <div className="field">
              <label htmlFor="person-iban">شبا</label>
              <input
                id="person-iban"
                disabled={lockedFields.iban}
                placeholder={lockedFields.iban ? PENDING_KEY_TEXT : undefined}
                dir="ltr"
                value={iban || "IR"}
                onFocus={() => !iban && setIban("IR")}
                onChange={(event) => setIban(ibanWithPrefix(event.target.value))}
              />
              {ibanValidation && !ibanValidation.valid && <span className="field__error">{ibanValidation.error}</span>}
            </div>
            <div className="field">
              <label htmlFor="person-bank-name">نام بانک</label>
              <input
                id="person-bank-name"
                disabled={lockedFields.bankName}
                placeholder={lockedFields.bankName ? PENDING_KEY_TEXT : undefined}
                value={bankName}
                onChange={(event) => {
                  setBankNameTouched(true);
                  setBankName(event.target.value);
                }}
              />
            </div>
            <div className="field">
              <label htmlFor="person-account-holder">نام صاحب حساب</label>
              <input
                id="person-account-holder"
                disabled={lockedFields.accountHolder}
                placeholder={lockedFields.accountHolder ? PENDING_KEY_TEXT : undefined}
                value={accountHolder}
                onChange={(event) => {
                  setAccountHolderTouched(true);
                  setAccountHolder(event.target.value);
                }}
              />
            </div>
          </div>
        )}

        {submitError && <p className="field__error">{submitError}</p>}
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={onClose}>
            انصراف
          </button>
          <button type="submit" className="form-actions__primary" disabled={!valid || submitting}>
            ذخیره
          </button>
        </div>

        {person && onArchiveRequest && (
          <div className="sheet__danger-zone">
            <button type="button" className="sheet__archive-button" onClick={onArchiveRequest}>
              {person.archived ? "بازگردانی از آرشیو" : "آرشیو کردن این شخص"}
            </button>
            {person.archived && onPermanentDeleteRequest && (
              <>
                <button
                  type="button"
                  className="sheet__archive-button sheet__archive-button--danger"
                  disabled={Boolean(permanentDeleteBlockedReason) || referencingEvents === undefined}
                  onClick={onPermanentDeleteRequest}
                >
                  حذف دائمی
                </button>
                {permanentDeleteBlockedReason && <p className="field__hint">{permanentDeleteBlockedReason}</p>}
              </>
            )}
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
