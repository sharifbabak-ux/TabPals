/** Display of values that arrived encrypted while this device still has no event key. Pure. */

export const PENDING_KEY_TEXT = "🔒 در انتظار دریافت کلید";

/** True for a stored `enc:v1:` value (ciphertext kept until the key arrives). */
export function isPendingKey(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("enc:v1:");
}

/** The text to show for a possibly-encrypted value: the lock marker, the value itself, or null when empty. */
export function displayOrPending(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  return isPendingKey(value) ? PENDING_KEY_TEXT : value;
}

/** A value that is safe to put into an editable field: ciphertext is never edited. */
export function editableValue(value: string | null | undefined): string {
  return isPendingKey(value) ? "" : (value ?? "");
}
