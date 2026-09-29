/**
 * Per-expense-row split explanation text for a member's statement
 * (docs/PLAN.md Stage 3B "MEMBER STATEMENT CONTENT" #2). Pure formatting
 * over a voucher's stored splitMode/participants/totalAmount — no lookups,
 * no I/O.
 */
import type { SplitMode } from "@/data/types";
import { formatAmount, toPersianDigits } from "./format";

export interface SplitExplanationParticipant {
  personId: string;
  weight: number;
}

export interface SplitExplanationInput {
  splitMode: SplitMode;
  totalAmount: number;
  participants: SplitExplanationParticipant[];
}

/** Builds the "سهیم‌ها بین چند نفر با چه نسبتی" text shown under an expense row for one participating member. */
export function buildSplitExplanation(voucher: SplitExplanationInput, personId: string): string {
  switch (voucher.splitMode) {
    case "equal": {
      const count = voucher.participants.length;
      return `مساوی بین ${toPersianDigits(count)} نفر (${formatAmount(voucher.totalAmount)} ÷ ${toPersianDigits(count)})`;
    }
    case "weight": {
      const totalWeight = voucher.participants.reduce((sum, p) => sum + p.weight, 0);
      const weight = voucher.participants.find((p) => p.personId === personId)?.weight ?? 0;
      return `ضریب ${toPersianDigits(weight)} از مجموع ${toPersianDigits(totalWeight)}`;
    }
    case "percent": {
      const percent = voucher.participants.find((p) => p.personId === personId)?.weight ?? 0;
      return `${toPersianDigits(percent)}٪ از مبلغ`;
    }
    case "exact":
      return "مبلغ مشخص";
  }
}
