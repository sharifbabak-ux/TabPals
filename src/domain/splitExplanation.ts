/**
 * Per-expense-row split explanation text for a member's statement
 * (docs/PLAN.md Stage 3B "MEMBER STATEMENT CONTENT" #2). Pure formatting
 * over a voucher's stored splitMode/participants/totalAmount — no lookups,
 * no I/O.
 */
import type { ItemizedPersonSnapshot, SplitMode } from "@/data/types";
import { formatAmount, toPersianDigits } from "./format";
import { formatItemizedItem } from "./groupOrder";

export interface SplitExplanationParticipant {
  personId: string;
  weight: number;
}

export interface SplitExplanationInput {
  splitMode: SplitMode;
  totalAmount: number;
  participants: SplitExplanationParticipant[];
  /** Itemized (group-order) vouchers only: this voucher's per-person snapshots. */
  itemizedPeople?: ItemizedPersonSnapshot[];
}

/**
 * Itemized (group-order) explanation for one person: their items (qty × price),
 * shared-item shares, then each extra's share — e.g.
 * "۲ × کوبیده (۱۲۰٬۰۰۰)، ۱ × دوغ (۲۰٬۰۰۰)\nسهم مالیات ۱۰٪: ۲۶٬۰۰۰، سهم سرویس: ۱۳٬۰۰۰".
 */
export function buildItemizedExplanation(person: ItemizedPersonSnapshot): string {
  const itemParts = [
    ...(person.personTotal !== null ? [`جمع سفارش: ${formatAmount(person.personTotal)}`] : person.items.map(formatItemizedItem)),
    ...person.sharedItems.map((s) => `سهم از ${s.name} مشترک: ${formatAmount(s.amount)}`)
  ];
  const extraParts = person.extras.filter((e) => e.share !== 0).map((e) => `سهم ${e.label}: ${formatAmount(e.share)}`);
  return [itemParts.join("، "), extraParts.join("، ")].filter(Boolean).join("\n");
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
    case "itemized": {
      const person = voucher.itemizedPeople?.find((p) => p.personId === personId);
      return person ? buildItemizedExplanation(person) : "بر اساس سفارش";
    }
  }
}
