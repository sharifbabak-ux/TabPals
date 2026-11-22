/** All Persian text of the group balance block and the settlement view (SG-4) in one place. */
export const EU_TEXT = {
  balancesTitle: "گروه‌ها",
  settlementTitle: "تسویه",
  modeLabel: "تسویه",
  modePeople: "افراد",
  modeGroups: "گروه‌ها",
  representative: "نماینده",
  settledChip: "تسویه‌شده",
  creditor: "طلبکار",
  debtor: "بدهکار",
  showMembers: "جزئیات اعضا",
  hideMembers: "بستن جزئیات",
  membersCount: (n: string) => `${n} نفر`,
  internalCancelled: (amount: string, currency: string) => `بدهی و طلب داخل گروه که با هم صفر شد: ${amount} ${currency}`,
  noInternal: "بین اعضا بدهی و طلبی که با هم صفر شود نبود.",
  nothingToSettle: "همه تسویه‌اند؛ پرداختی لازم نیست.",
  treasurerRole: "مسئول صندوق",
  groupOf: (group: string, rep: string) => `نمایندهٔ گروه «${group}» (${rep})`,
  totalCollected: "جمع دریافتی مسئول صندوق",
  totalPaidOut: "جمع پرداختی مسئول صندوق",
  recordNote: "پرداخت‌ها را از بخش «اسناد» ثبت کنید. در حالت گروهی، پرداخت را به نام نماینده ثبت کنید تا جمع گروه درست بماند.",
  hubGroupNote: (group: string, amount: string, currency: string, creditor: boolean) =>
    `مسئول صندوق عضو گروه «${group}» است؛ باقی‌ماندهٔ تراز این گروه (${amount} ${currency} ${creditor ? "طلب" : "بدهی"}) سهم خود او است و بیرون از برنامه تسویه می‌شود.`,
  hubGroupSettled: (group: string) => `مسئول صندوق عضو گروه «${group}» است؛ تراز این گروه صفر است و چیزی برای تسویه‌ی بیرونی نمانده.`,
  invalidWarning: "گروه‌های این رویداد الان معتبر نیستند؛ تسویه به‌صورت فردی نشان داده می‌شود. ابتدا گروه‌ها را اصلاح کنید:",
  noTreasurerWarning: "برای تسویه ابتدا مسئول صندوق رویداد را تعیین کنید."
} as const;

export const EU_HELP = {
  balances: {
    title: "تراز گروه‌ها",
    body: "در حالت گروهی، بدهی و طلب اعضای هر گروه با هم جمع می‌شود و پرداخت از طریق نماینده انجام می‌شود. تراز فردی هر نفر تغییر نمی‌کند."
  },
  mode: {
    title: "تسویه‌ی افراد یا گروه‌ها",
    body: "در حالت گروهی، بدهی و طلب اعضای هر گروه با هم جمع می‌شود و پرداخت از طریق نماینده انجام می‌شود. در حالت افراد، تسویه‌ی هر نفر جدا نشان داده می‌شود. تراز فردی هر نفر در هر دو حالت تغییر نمی‌کند."
  },
  hubGroup: {
    title: "گروهِ مسئول صندوق",
    body: "مسئول صندوق در یک گروه است، پس تراز گروه با خودش جمع می‌شود. آنچه از تراز گروه می‌ماند، حساب خودِ او با اعضای گروه است و بیرون از برنامه تسویه می‌شود. مثلاً اگر گروه ۲۰۰ طلب داشته باشد، این ۲۰۰ بین خودشان حساب می‌شود."
  }
} as const;
