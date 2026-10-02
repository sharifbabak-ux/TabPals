import { useState } from "react";
import { orderSessionsRepository } from "@/data/repositories";
import type { OrderCategory, SessionMenuItem } from "@/data/types";
import { ORDER_CATEGORY_LABELS, suggestOrderCategory } from "@/domain/orderCategory";
import { formatAmount } from "@/domain/format";
import { AmountInput } from "@/ui/components/AmountInput";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { CategoryChips } from "./CategoryChips";

interface MenuEditorSheetProps {
  open: boolean;
  sessionId: string;
  items: SessionMenuItem[];
  currency: string;
  readOnly: boolean;
  onClose: () => void;
}

/** «منوی سریع»: the quick-tap items of this meal — add (optional price), edit, reorder, remove (docs/PLAN.md Group Order UI #4). */
export function MenuEditorSheet({ open, sessionId, items, currency, readOnly, onClose }: MenuEditorSheetProps) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const [category, setCategory] = useState<OrderCategory>("other");
  const [categoryTouched, setCategoryTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  async function handleAdd() {
    await run(async () => {
      await orderSessionsRepository.addMenuItem(sessionId, { name, price: price > 0 ? price : undefined, category });
      setName("");
      setPrice(0);
      setCategory("other");
      setCategoryTouched(false);
    });
  }

  function move(index: number, delta: -1 | 1) {
    const ids = items.map((i) => i.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(() => orderSessionsRepository.reorderMenuItems(sessionId, ids));
  }

  return (
    <BottomSheet open={open} title="منوی سریع" onClose={onClose}>
      {items.length === 0 && <p className="field__hint">هنوز قلمی در منوی سریع نیست؛ با افزودن اقلام پرتکرار، ثبت سفارش با یک لمس انجام می‌شود.</p>}
      <ul className="list">
        {items.map((item, index) => (
          <li key={item.id} className="list-item menu-editor__row">
            <div className="list-item__main">
              <span className="list-item__title">{item.name}</span>
              <span className="list-item__subtitle">{ORDER_CATEGORY_LABELS[item.category ?? "other"]} · {item.price !== undefined ? `${formatAmount(item.price)} ${currency}` : "بدون قیمت"}</span>
            </div>
            {!readOnly && (
              <div className="menu-editor__actions">
                <button type="button" className="list-item__action" onClick={() => move(index, -1)} disabled={index === 0} aria-label="بالا">
                  ↑
                </button>
                <button type="button" className="list-item__action" onClick={() => move(index, 1)} disabled={index === items.length - 1} aria-label="پایین">
                  ↓
                </button>
                <button type="button" className="list-item__action" onClick={() => run(() => orderSessionsRepository.removeMenuItem(item.id))}>
                  حذف
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {!readOnly && (
        <div className="menu-editor__add">
          <h3 className="section-title">افزودن قلم</h3>
          <div className="field">
            <label htmlFor="menu-item-name">نام</label>
            <input
              id="menu-item-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                // The suggestion only pre-selects; once the user picks a category it stays theirs.
                if (!categoryTouched) setCategory(suggestOrderCategory(e.target.value));
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="menu-item-price">قیمت (اختیاری)</label>
            <AmountInput id="menu-item-price" value={price} onChange={setPrice} />
          </div>
          <div className="field">
            <label>دسته</label>
            <CategoryChips
              value={category}
              onChange={(c) => {
                setCategory(c);
                setCategoryTouched(true);
              }}
            />
          </div>
          {error && <p className="field__error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="form-actions__primary" disabled={!name.trim()} onClick={handleAdd}>
              افزودن
            </button>
          </div>
        </div>
      )}
      {readOnly && error && <p className="field__error">{error}</p>}
    </BottomSheet>
  );
}
