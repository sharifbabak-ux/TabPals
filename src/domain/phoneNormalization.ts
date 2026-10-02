/**
 * Iranian mobile phone normalization (docs/PLAN.md Stage 3C send menu).
 * Accepts the common input shapes users type or paste — local
 * "09xxxxxxxxx", "+98xxxxxxxxxx", "0098xxxxxxxxxx", with Persian/Arabic
 * digits and stray spaces/dashes — and normalizes them all to the bare
 * "989xxxxxxxxx" form used by wa.me/sms: links. Returns null for anything
 * that isn't a valid 10-digit Iranian mobile number.
 */
import { normalizeDigits } from "./paymentValidation";

export function normalizeIranianPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digitsOnly = normalizeDigits(input).replace(/[^\d]/g, "");

  let local: string;
  if (digitsOnly.startsWith("0098")) {
    local = digitsOnly.slice(4);
  } else if (digitsOnly.startsWith("98") && digitsOnly.length >= 12) {
    local = digitsOnly.slice(2);
  } else if (digitsOnly.startsWith("0")) {
    local = digitsOnly.slice(1);
  } else {
    local = digitsOnly;
  }

  if (!/^9\d{9}$/.test(local)) return null;
  return `98${local}`;
}
