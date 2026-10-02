import type { OrderCategory } from "@/data/types";
import { ORDER_CATEGORIES, ORDER_CATEGORY_LABELS } from "@/domain/orderCategory";

interface CategoryChipsProps {
  value: OrderCategory;
  onChange: (category: OrderCategory) => void;
}

/** Category selector (docs/PLAN.md GO-1.1): single-choice chips in the fixed waiter-list order. */
export function CategoryChips({ value, onChange }: CategoryChipsProps) {
  return (
    <div className="category-chips" role="radiogroup" aria-label="دسته">
      {ORDER_CATEGORIES.map((category) => (
        <button
          key={category}
          type="button"
          role="radio"
          aria-checked={value === category}
          className={`category-chip${value === category ? " category-chip--selected" : ""}`}
          onClick={() => onChange(category)}
        >
          {ORDER_CATEGORY_LABELS[category]}
        </button>
      ))}
    </div>
  );
}
