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
