import type { SplitMode, VoucherType } from "@/data/types";
import type { StatementFundEntry } from "@/domain/statementBuilder";

export const SPLIT_MODE_LABELS: Record<SplitMode, string> = {
  equal: "مساوی",
  weight: "ضریبی",
  percent: "درصدی",
  exact: "مبلغ مشخص",
  itemized: "بر اساس سفارش"
};

export const VOUCHER_TYPE_LABELS: Record<VoucherType, string> = {
  expense: "هزینه",
  contribution: "واریز",
  settlement: "تسویه"
};

export const FUND_ENTRY_LABELS: Record<StatementFundEntry["kind"], string> = {
  contribution: "واریز به صندوق",
  receivedAsTreasurer: "دریافت به‌عنوان مسئول صندوق",
  settlementPaid: "تسویه پرداختی",
  settlementReceived: "تسویه دریافتی"
};

/** Persian text of the group statement (SG-5). */
export const GROUP_STATEMENT_TEXT = {
  kindLabel: "صورت‌حساب گروه",
  groupWord: "گروه",
  representative: "نماینده",
  membersLine: "اعضا",
  membersTitle: "حساب اعضای گروه",
  colMember: "عضو",
  colBalance: "مانده",
  archivedNote: "(کنار گذاشته‌شده)",
  settledLine: "حساب صاف است",
  internalCancelled: "بدهی و طلبِ داخل گروه که با هم صفر شد",
  noInternal: "بدهی و طلبی که با هم صفر شود نبود",
  totalTitle: "حساب نهایی گروه",
  groupBalance: "مانده‌ی گروه",
  settledChip: "تسویه‌شده",
  paymentTitle: "اطلاعات پرداخت",
  treasurerLabel: "مسئول صندوق",
  holderPrefix: "به نام"
} as const;
