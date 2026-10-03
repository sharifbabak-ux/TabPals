/** Persian messages for the API's error `code`s (docs/API.md "Error codes") and op-rejection reasons. */
const MESSAGES: Record<string, string> = {
  "bad-request": "درخواست نامعتبر است.",
  "bad-json": "درخواست نامعتبر است.",
  "invalid-field": "یکی از مقادیر ارسالی نامعتبر است.",
  unauthorized: "دسترسی این دستگاه معتبر نیست.",
  "device-revoked": "دسترسی این دستگاه قطع شده است.",
  forbidden: "اجازه‌ی این کار را ندارید.",
  "not-found": "پیدا نشد.",
  "event-not-found": "ایونت روی سرور پیدا نشد.",
  "member-not-found": "عضو پیدا نشد.",
  "device-not-found": "دستگاه پیدا نشد.",
  "invite-not-found": "دعوت‌نامه پیدا نشد؛ کد یا لینک را بررسی کنید.",
  "event-exists": "این ایونت قبلاً روی سرور ساخته شده است.",
  "member-exists": "این عضو قبلاً ثبت شده است.",
  "invite-used": "این دعوت‌نامه قبلاً استفاده شده است.",
  "last-admin": "هر ایونت باید دست‌کم یک مدیر داشته باشد؛ ابتدا مدیر دیگری تعیین کنید.",
  "invite-expired": "مهلت این دعوت‌نامه تمام شده است؛ از مدیر ایونت دعوت‌نامه‌ی جدید بخواهید.",
  "invite-revoked": "این دعوت‌نامه لغو شده است.",
  "payload-too-large": "حجم داده‌ی ارسالی بیش از حد مجاز است.",
  "rate-limited": "تعداد درخواست‌ها زیاد بود؛ کمی بعد دوباره تلاش کنید.",
  "internal-error": "خطای سرور؛ کمی بعد دوباره تلاش کنید.",
  network: "اتصال به سرور برقرار نشد؛ اینترنت خود را بررسی کنید.",
  // op rejection reasons
  "bad-op": "تغییر نامعتبر بود.",
  "op-too-large": "این تغییر بیش از حد بزرگ است.",
  "unknown-entity": "نوع داده شناخته‌شده نیست.",
  "unknown-type": "نوع تغییر شناخته‌شده نیست.",
  "forbidden-entity": "نقش شما اجازه‌ی تغییر این داده را نمی‌دهد.",
  "forbidden-profile": "فقط خودِ عضو یا مدیر می‌تواند نمایه را تغییر دهد.",
  "forbidden-purge": "فقط مدیر می‌تواند ایونت را پاک کند."
};

export function onlineErrorMessage(code: string | null | undefined, fallback?: string): string {
  if (code && MESSAGES[code]) return MESSAGES[code];
  return fallback || "خطای ناشناخته؛ دوباره تلاش کنید.";
}

/** Persian labels for the admin audit log (docs/API.md `GET audit`). */
const AUDIT_LABELS: Record<string, string> = {
  "event.created": "ایونت آنلاین ساخته شد",
  "member.added": "عضو اضافه شد",
  "roles.changed": "نقش‌ها تغییر کرد",
  "invite.created": "دعوت‌نامه ساخته شد",
  "invite.redeemed": "دعوت‌نامه استفاده شد",
  "invite.revoked": "دعوت‌نامه لغو شد",
  "device.revoked": "دسترسی یک دستگاه قطع شد"
};

export function auditActionLabel(action: string): string {
  return AUDIT_LABELS[action] ?? action;
}
