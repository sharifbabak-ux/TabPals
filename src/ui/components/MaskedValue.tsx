import { useState } from "react";
import { formatCardNumberGrouped, formatIbanGrouped } from "@/domain/paymentValidation";
import { maskCardNumber, maskIban } from "@/domain/mask";
import { displayOrPending, isPendingKey } from "@/domain/encryptedDisplay";
import "./MaskedValue.css";

interface MaskedValueProps {
  kind: "card" | "iban";
  /** Raw (normalized) or already grouped value. */
  value: string;
}

/**
 * Card numbers and IBANs are masked by default (۵۸۵۹ ●●●● ●●●● ۳۷۲۴) and revealed on tap.
 * When printed, the full number is shown (printing is an explicit action; the privacy setting can remove it entirely).
 */
export function MaskedValue({ kind, value }: MaskedValueProps) {
  const [revealed, setRevealed] = useState(false);
  if (isPendingKey(value)) return <span className="masked-value__pending">{displayOrPending(value)}</span>;
  const compact = value.replace(/\s+/g, "");
  const full = kind === "card" ? formatCardNumberGrouped(compact) : formatIbanGrouped(compact);
  const masked = kind === "card" ? maskCardNumber(compact) : maskIban(compact);
  return (
    <span className="masked-value">
      <span className="masked-value__text" dir="ltr">
        {revealed ? full : masked}
      </span>
      <span className="masked-value__print" dir="ltr">
        {full}
      </span>
      <button type="button" className="masked-value__toggle no-print" onClick={() => setRevealed((v) => !v)} aria-pressed={revealed}>
        {revealed ? "پنهان" : "نمایش"}
      </button>
    </span>
  );
}
