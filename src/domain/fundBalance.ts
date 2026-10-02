/**
 * Fund-position wording for the comprehensive report and the treasurer
 * statement (docs/PLAN.md GO-1.1): never a negative "باقیمانده‌ی صندوق".
 * When the treasurer paid more than was contributed, the shortfall is
 * stated as money the treasurer spent personally.
 */
import { formatAmount } from "./format";

export interface FundBalanceLine {
  kind: "fund" | "personal";
  text: string;
}

export function describeFundBalance(totalContributed: number, totalPaidByTreasurer: number, currency: string): FundBalanceLine {
  const difference = totalContributed - totalPaidByTreasurer;
  if (difference < 0) {
    return { kind: "personal", text: `مسئول صندوق ${formatAmount(-difference)} ${currency} از محل شخصی پرداخت کرده است` };
  }
  return { kind: "fund", text: `موجودی صندوق: ${formatAmount(difference)} ${currency}` };
}
