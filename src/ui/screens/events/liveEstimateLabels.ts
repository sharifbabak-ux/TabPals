/** Persian text of the provisional live balance estimate of an OPEN event (docs/PLAN.md, LIVE-1). */
export const LIVE_TEXT = {
  title: "برآورد وضعیت حساب تا این لحظه",
  badge: "موقت — تا لحظه‌ی حال",
  line: "با ثبت اسناد جدید تغییر می‌کند؛ صورت‌حساب رسمی بعد از بستن رویداد صادر می‌شود.",
  calculatedAt: (when: string) => `زمان محاسبه: ${when}`,
  openSessions: (n: string) => `${n} نشست باز؛ سفارش‌های آن‌ها هنوز در حساب نیست`,
  empty: "هنوز عضوی یا سندی برای برآورد نیست."
} as const;
