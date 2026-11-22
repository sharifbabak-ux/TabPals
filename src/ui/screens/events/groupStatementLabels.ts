/** Persian text of the group-statement parts of the «صورت‌حساب‌ها» tab (SG-5). */
export const GS_TEXT = {
  issueAll: "صدور صورت‌حساب گروه‌ها",
  issueOne: "صدور برای یک گروه",
  pickerTitle: "صدور صورت‌حساب برای یک گروه",
  groupWord: "گروه",
  invalidTitle: "گروه‌هایی که صورت‌حساب ندارند",
  invalidLine: (name: string, reasons: string) => `گروه «${name}» معتبر نیست و صورت‌حساب آن صادر نمی‌شود: ${reasons}`,
  fallbackName: "گروه",
  staleHint: "تراز اعضا، اعضای گروه، نماینده، نام گروه یا مسئول صندوق بعد از صدور عوض شده است؛ دوباره صادر کنید."
} as const;
