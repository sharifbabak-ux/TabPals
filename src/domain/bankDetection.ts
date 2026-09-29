/**
 * Suggests an Iranian bank's name from a card number's IIN (first 6
 * digits) or from the 3-digit bank code embedded in an IBAN (شبا)
 * (docs/PLAN.md Stage 3B.1). Pure lookups against a well-known published
 * list; unknown prefixes/codes return null so the caller shows no
 * suggestion rather than a wrong one. Callers must never overwrite a bank
 * name the user already typed — see CLAUDE.md UI rules.
 */
import { normalizeDigits } from "./paymentValidation";

/** Card IIN (first 6 digits) -> bank name. */
const BANK_BY_CARD_IIN: Record<string, string> = {
  "603799": "بانک ملی ایران",
  "589210": "بانک سپه",
  "627648": "بانک توسعه صادرات ایران",
  "627961": "بانک صنعت و معدن",
  "603769": "بانک صادرات ایران",
  "610433": "بانک ملت",
  "627412": "بانک اقتصاد نوین",
  "622106": "بانک پارسیان",
  "639347": "بانک پاسارگاد",
  "627353": "بانک تجارت",
  "502806": "بانک شهر",
  "628023": "بانک مسکن",
  "589463": "بانک رفاه کارگران",
  "502910": "بانک کارآفرین",
  "639599": "بانک قوامین",
  "504172": "بانک رسالت",
  "505785": "بانک ایران زمین",
  "636949": "بانک حکمت ایرانیان",
  "505416": "بانک گردشگری",
  "636214": "بانک آینده",
  "502938": "بانک دی",
  "639370": "موسسه اعتباری ملل"
};

/** 3-digit IBAN bank code (right after "IR" + the 2 check digits) -> bank name. */
const BANK_BY_IBAN_CODE: Record<string, string> = {
  "011": "بانک صنعت و معدن",
  "012": "بانک ملت",
  "013": "بانک رفاه کارگران",
  "015": "بانک سپه",
  "016": "بانک کشاورزی",
  "017": "بانک ملی ایران",
  "018": "بانک تجارت",
  "019": "بانک صادرات ایران",
  "020": "بانک توسعه صادرات",
  "021": "پست بانک ایران",
  "022": "بانک توسعه تعاون",
  "051": "بانک پاسارگاد",
  "052": "بانک اقتصاد نوین",
  "053": "بانک سامان",
  "054": "بانک پارسیان",
  "055": "بانک سرمایه",
  "056": "بانک سینا",
  "057": "بانک خاورمیانه",
  "058": "بانک کارآفرین",
  "059": "بانک گردشگری",
  "060": "بانک حکمت ایرانیان",
  "061": "بانک دی",
  "063": "بانک ایران زمین",
  "064": "بانک آینده",
  "065": "بانک انصار",
  "066": "بانک شهر",
  "069": "موسسه اعتباری ملل",
  "070": "بانک مهر اقتصاد"
};

/** Suggests a bank name from a card number's first 6 digits, or null if unrecognized/too short. */
export function detectBankFromCardNumber(cardNumber: string): string | null {
  const digits = normalizeDigits(cardNumber).replace(/[\s-]/g, "");
  if (digits.length < 6) return null;
  return BANK_BY_CARD_IIN[digits.slice(0, 6)] ?? null;
}

/** Suggests a bank name from an IBAN's embedded 3-digit bank code, or null if unrecognized/too short. */
export function detectBankFromIban(iban: string): string | null {
  const stripped = normalizeDigits(iban).replace(/\s/g, "").toUpperCase();
  const withPrefix = stripped.startsWith("IR") ? stripped : `IR${stripped}`;
  if (withPrefix.length < 7) return null;
  const bankCode = withPrefix.slice(4, 7);
  return BANK_BY_IBAN_CODE[bankCode] ?? null;
}
