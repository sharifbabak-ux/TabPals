/** Masking of card numbers and IBANs for display (docs/PLAN.md "Privacy"). Pure. */
import { toPersianDigits } from "./format";

const DOT = "●●●●";

/** "5859831012343724" → "۵۸۵۹ ●●●● ●●●● ۳۷۲۴". Input may contain spaces/Persian digits. */
export function maskCardNumber(card: string): string {
  const digits = latin(card).replace(/\D/g, "");
  if (digits.length < 8) return DOT;
  return `${toPersianDigits(digits.slice(0, 4))} ${DOT} ${DOT} ${toPersianDigits(digits.slice(-4))}`;
}

/** "IR062960000000100324200001" → "IR۰۶ ●●●● ●●●● ●●●● ●●●● ۰۰۰۱" (country+check digits and the last four stay visible). */
export function maskIban(iban: string): string {
  const compact = latin(iban).replace(/\s+/g, "").toUpperCase();
  if (compact.length < 10) return DOT;
  return `${compact.slice(0, 2)}${toPersianDigits(compact.slice(2, 4))} ${DOT} ${DOT} ${DOT} ${DOT} ${toPersianDigits(compact.slice(-4))}`;
}

function latin(text: string): string {
  return text.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}
