/**
 * Waiter-list categories (docs/PLAN.md GO-1.1): fixed labels/order and a
 * pure keyword-based suggestion. The suggestion only pre-selects a
 * category in the UI — the user can always change it — and an unknown name
 * is "other", never a guessed "main".
 */
import type { OrderCategory } from "@/data/types";
import { normalizeName } from "./nameNormalization";

/** Fixed display order of the waiter list. */
export const ORDER_CATEGORIES: OrderCategory[] = ["appetizer", "salad", "main", "drink", "dessert_hot", "other"];

export const ORDER_CATEGORY_LABELS: Record<OrderCategory, string> = {
  appetizer: "پیش‌غذا",
  salad: "سالاد",
  main: "غذای اصلی",
  drink: "نوشیدنی",
  dessert_hot: "دسر و نوشیدنی گرم",
  other: "سایر"
};

export const DEFAULT_ORDER_CATEGORY: OrderCategory = "other";

export function isOrderCategory(value: unknown): value is OrderCategory {
  return typeof value === "string" && (ORDER_CATEGORIES as string[]).includes(value);
}

/** Position in the fixed order (unknown/missing values sort as "other"). */
export function categoryRank(category: OrderCategory | undefined): number {
  const index = ORDER_CATEGORIES.indexOf(category ?? DEFAULT_ORDER_CATEGORY);
  return index === -1 ? ORDER_CATEGORIES.length - 1 : index;
}

const KEYWORDS: { category: OrderCategory; words: string[] }[] = [
  { category: "dessert_hot", words: ["چای", "قهوه", "اسپرسو", "نسکافه", "دمنوش", "بستنی", "کیک", "دسر", "فالوده"] },
  { category: "drink", words: ["دوغ", "نوشابه", "آب", "آبمیوه", "لیموناد", "دلستر"] },
  { category: "appetizer", words: ["سوپ", "ماست", "زیتون", "بورانی", "کشک", "میرزاقاسمی", "پیش‌غذا"] },
  { category: "main", words: ["کباب", "کوبیده", "جوجه", "برگ", "چلو", "پلو", "خورش", "استیک", "پیتزا", "برگر", "ماهی", "میگو"] }
];

const NORMALIZED_KEYWORDS = KEYWORDS.map(({ category, words }) => ({ category, words: words.map(normalizeName) }));

/** Words of 3+ letters also match as a prefix ("کبابکوبیده"); shorter ones ("آب") must match a whole word so "آبگوشت" isn't a drink. */
function wordMatches(token: string, keyword: string): boolean {
  return token === keyword || (keyword.length >= 3 && token.startsWith(keyword));
}

/** Suggests a category from an item name. Any name containing «سالاد» is a salad; otherwise the first matching word decides; no match → "other". */
export function suggestOrderCategory(itemName: string): OrderCategory {
  const name = normalizeName(itemName);
  if (!name) return DEFAULT_ORDER_CATEGORY;
  if (name.includes(normalizeName("سالاد"))) return "salad";

  for (const token of name.split(" ")) {
    for (const { category, words } of NORMALIZED_KEYWORDS) {
      if (words.some((word) => wordMatches(token, word))) return category;
    }
  }
  return DEFAULT_ORDER_CATEGORY;
}
