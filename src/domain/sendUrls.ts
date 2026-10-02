/**
 * URL builders for the statement send menu's chat channels (docs/PLAN.md
 * Stage 3C). Pure string building only — normalizing the phone number
 * (see phoneNormalization.ts) and detecting the device OS for the SMS
 * separator (see src/platform) both happen before calling these.
 */

/** "واتس‌اپ (متن خلاصه)": wa.me with the member's normalized phone, or the bare picker link when no phone is on file. */
export function buildWhatsAppUrl(normalizedPhone: string | null, text: string): string {
  const base = normalizedPhone ? `https://wa.me/${normalizedPhone}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(text)}`;
}

/** "تلگرام (متن خلاصه)": Telegram's share dialog with the statement link and a summary text. */
export function buildTelegramUrl(statementUrl: string | null, text: string): string {
  const urlParam = statementUrl ? `url=${encodeURIComponent(statementUrl)}&` : "";
  return `https://t.me/share/url?${urlParam}text=${encodeURIComponent(text)}`;
}

/**
 * "پیامک": an sms: URI with the member's phone (when known) and a body of
 * the summary text + link. The body query separator differs by platform:
 * "?body=" on Android, "&body=" on iOS.
 */
export function buildSmsUrl(normalizedPhone: string | null, body: string, isIOS: boolean): string {
  const separator = isIOS ? "&" : "?";
  const target = normalizedPhone ?? "";
  return `sms:${target}${separator}body=${encodeURIComponent(body)}`;
}
