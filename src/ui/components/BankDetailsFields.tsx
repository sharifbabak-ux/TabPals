import { useEffect, useState } from "react";
import { detectBankFromCardNumber, detectBankFromIban } from "@/domain/bankDetection";
import { validateCardNumber, validateIban } from "@/domain/paymentValidation";

export interface BankDetailsValue {
  cardNumber: string;
  iban: string;
  bankName: string;
  accountHolder: string;
}

/** Groups digits into 4-character chunks for live display while typing. */
export function groupDigitsForDisplay(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

export function ibanWithPrefix(value: string): string {
  const stripped = value.replace(/[^\dIRir۰-۹٠-٩]/g, "").toUpperCase();
  const withoutPrefix = stripped.startsWith("IR") ? stripped.slice(2) : stripped;
  return `IR${withoutPrefix}`;
}

/** Validation of the bank fields; empty fields are valid. */
export function validateBankDetails(value: BankDetailsValue): { valid: boolean; card: ReturnType<typeof validateCardNumber> | null; iban: ReturnType<typeof validateIban> | null } {
  const card = value.cardNumber.trim() ? validateCardNumber(value.cardNumber) : null;
  const ibanDigits = value.iban.replace(/^IR/i, "").trim();
  const iban = ibanDigits ? validateIban(value.iban) : null;
  return { valid: (card?.valid ?? true) && (iban?.valid ?? true), card, iban };
}

interface BankDetailsFieldsProps {
  idPrefix: string;
  value: BankDetailsValue;
  onChange: (value: BankDetailsValue) => void;
  /** Fields whose stored value is still ciphertext: shown disabled with the lock marker, never edited. */
  lockedFields?: ReadonlySet<keyof BankDetailsValue>;
  lockedText?: string;
}

/** Card, IBAN (validated), bank name (auto-suggested from card/IBAN until typed over) and account holder. */
export function BankDetailsFields({ idPrefix, value, onChange, lockedFields, lockedText }: BankDetailsFieldsProps) {
  const [bankTouched, setBankTouched] = useState(Boolean(value.bankName));
  const { card, iban } = validateBankDetails(value);
  const locked = (field: keyof BankDetailsValue) => lockedFields?.has(field) ?? false;

  useEffect(() => {
    if (bankTouched || locked("bankName")) return;
    const suggestion = detectBankFromCardNumber(value.cardNumber) ?? (value.iban ? detectBankFromIban(value.iban) : null);
    if (suggestion && suggestion !== value.bankName) onChange({ ...value, bankName: suggestion });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.cardNumber, value.iban, bankTouched]);

  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-card`}>شماره کارت</label>
        <input
          id={`${idPrefix}-card`}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          disabled={locked("cardNumber")}
          placeholder={locked("cardNumber") ? lockedText : undefined}
          value={locked("cardNumber") ? "" : value.cardNumber}
          onChange={(event) => onChange({ ...value, cardNumber: groupDigitsForDisplay(event.target.value) })}
        />
        {card && !card.valid && <span className="field__error">{card.error}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-iban`}>شبا</label>
        <input
          id={`${idPrefix}-iban`}
          dir="ltr"
          autoComplete="off"
          disabled={locked("iban")}
          placeholder={locked("iban") ? lockedText : undefined}
          value={locked("iban") ? "" : value.iban || "IR"}
          onFocus={() => !value.iban && onChange({ ...value, iban: "IR" })}
          onChange={(event) => onChange({ ...value, iban: ibanWithPrefix(event.target.value) })}
        />
        {iban && !iban.valid && <span className="field__error">{iban.error}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-bank`}>نام بانک</label>
        <input
          id={`${idPrefix}-bank`}
          disabled={locked("bankName")}
          placeholder={locked("bankName") ? lockedText : undefined}
          value={locked("bankName") ? "" : value.bankName}
          onChange={(event) => {
            setBankTouched(true);
            onChange({ ...value, bankName: event.target.value });
          }}
        />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-holder`}>نام صاحب حساب</label>
        <input
          id={`${idPrefix}-holder`}
          disabled={locked("accountHolder")}
          placeholder={locked("accountHolder") ? lockedText : undefined}
          value={locked("accountHolder") ? "" : value.accountHolder}
          onChange={(event) => onChange({ ...value, accountHolder: event.target.value })}
        />
      </div>
    </>
  );
}
