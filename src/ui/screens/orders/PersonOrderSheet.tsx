import { useEffect, useMemo, useState } from "react";
import { orderSessionsRepository } from "@/data/repositories";
import { computePersonSubtotals } from "@/domain/groupOrder";
import { formatAmount, toPersianDigits } from "@/domain/format";
import { AmountInput } from "@/ui/components/AmountInput";
import { Avatar } from "@/ui/components/Avatar";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { useWizardBackTrap } from "@/ui/hooks/useWizardBackTrap";
import { QuantityStepper } from "./QuantityStepper";
import type { OrderSessionData } from "./useOrderSession";

interface PersonOrderSheetProps {
  open: boolean;
  person: { personId: string; name: string; photo?: Blob } | null;
  data: OrderSessionData;
  currency: string;
  /** False once the event is closed or the session is finished/not accepting lines. */
  editable: boolean;
  onClose: () => void;
}

type View = "main" | "free";

/** One person's order: tap quick-menu chips or type a free item; quantity, optional unit price and note; optional per-person total (docs/PLAN.md Group Order UI #5). */
export function PersonOrderSheet({ open, person, data, currency, editable, onClose }: PersonOrderSheetProps) {
  const [view, setView] = useState<View>("main");
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState(0);
  const [note, setNote] = useState("");
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const personId = person?.personId ?? "";
  const ownLines = useMemo(() => data.lines.filter((l) => l.personId === personId), [data.lines, personId]);
  const savedTotal = data.totals.find((t) => t.personId === personId)?.total ?? 0;
  const subtotal = useMemo(
    () => computePersonSubtotals(data.lines, data.totals).find((p) => p.personId === personId),
    [data.lines, data.totals, personId]
  );

  useEffect(() => {
    if (!open) return;
    setView("main");
    setError(null);
    setTotal(savedTotal);
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, personId]);

  useWizardBackTrap(open, () => {
    if (view === "free") setView("main");
    else onClose();
  });

  function resetForm() {
    setName("");
    setQuantity(1);
    setPrice(0);
    setNote("");
  }

  async function run(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  function addFromMenu(item: OrderSessionData["menuItems"][number]) {
    // Tapping the same chip again just bumps the quantity of that plain line.
    const existing = ownLines.find((l) => l.menuItemId === item.id && !l.note);
    if (existing) return run(() => orderSessionsRepository.updateLine(existing.id, { quantity: existing.quantity + 1 }));
    return run(() =>
      orderSessionsRepository.addLine(data.session.id, { personId, menuItemId: item.id, itemName: item.name, quantity: 1, unitPrice: item.price })
    );
  }

  async function addFree() {
    await run(async () => {
      await orderSessionsRepository.addLine(data.session.id, {
        personId,
        itemName: name,
        quantity,
        unitPrice: price > 0 ? price : undefined,
        note
      });
      resetForm();
      setView("main");
    });
  }

  if (!person) return null;

  return (
    <BottomSheet open={open} title={`سفارش ${person.name}`} onClose={onClose}>
      <div className="person-order__header">
        <Avatar id={person.personId} name={person.name} photo={person.photo} size={44} />
        <div>
          <strong>{person.name}</strong>
          {subtotal && subtotal.hasLines && (
            <span className="field__hint">
              {subtotal.computable ? `جمع: ${formatAmount(subtotal.subtotal)} ${currency}` : "قیمت برخی اقلام هنوز وارد نشده"}
            </span>
          )}
        </div>
      </div>

      {view === "main" ? (
        <>
          {editable && data.menuItems.length > 0 && (
            <>
              <h3 className="section-title">منوی سریع</h3>
              <div className="menu-chips">
                {data.menuItems.map((item) => (
                  <button key={item.id} type="button" className="menu-chip" onClick={() => addFromMenu(item)}>
                    {item.name}
                    {item.price !== undefined && <small>{formatAmount(item.price)}</small>}
                  </button>
                ))}
              </div>
            </>
          )}

          {editable && (
            <div className="form-actions">
              <button type="button" className="form-actions__secondary" onClick={() => setView("free")}>
                + قلم دلخواه
              </button>
            </div>
          )}

          <h3 className="section-title">اقلام ثبت‌شده</h3>
          {ownLines.length === 0 && <p className="field__hint">هنوز سفارشی ثبت نشده است.</p>}
          <ul className="list">
            {ownLines.map((line) => (
              <li key={line.id} className="list-item order-line">
                <div className="list-item__main">
                  <span className="list-item__title">{line.itemName}</span>
                  <span className="list-item__subtitle">
                    {line.unitPrice !== undefined ? `${toPersianDigits(line.quantity)} × ${formatAmount(line.unitPrice)} = ${formatAmount(line.quantity * line.unitPrice)} ${currency}` : "بدون قیمت"}
                    {line.note ? ` · ${line.note}` : ""}
                  </span>
                </div>
                {editable ? (
                  <div className="order-line__controls">
                    <QuantityStepper value={line.quantity} onChange={(q) => run(() => orderSessionsRepository.updateLine(line.id, { quantity: q }))} />
                    <button type="button" className="list-item__action" onClick={() => run(() => orderSessionsRepository.removeLine(line.id))}>
                      حذف
                    </button>
                  </div>
                ) : (
                  <span className="badge">{toPersianDigits(line.quantity)}</span>
                )}
              </li>
            ))}
          </ul>

          {editable && (
            <div className="field person-order__total">
              <label htmlFor="person-total">جمع سفارش این نفر (اختیاری)</label>
              <p className="field__hint">اگر قیمت تک‌تک اقلام را نمی‌دانید، فقط جمع کل سفارش این نفر را وارد کنید.</p>
              <AmountInput id="person-total" value={total} onChange={setTotal} />
              <div className="form-actions">
                <button
                  type="button"
                  className="form-actions__secondary"
                  disabled={total === savedTotal}
                  onClick={() => run(() => orderSessionsRepository.setPersonTotal(data.session.id, personId, total > 0 ? total : null))}
                >
                  ذخیره‌ی جمع
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <button type="button" className="back-link" onClick={() => setView("main")}>
            ← بازگشت
          </button>
          <div className="field">
            <label htmlFor="free-item-name">نام قلم</label>
            <input id="free-item-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>تعداد</label>
            <QuantityStepper value={quantity} onChange={setQuantity} />
          </div>
          <div className="field">
            <label htmlFor="free-item-price">قیمت واحد (اختیاری)</label>
            <AmountInput id="free-item-price" value={price} onChange={setPrice} />
          </div>
          <div className="field">
            <label htmlFor="free-item-note">توضیح (اختیاری)</label>
            <input id="free-item-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً بدون پیاز" />
          </div>
          <div className="form-actions">
            <button type="button" className="form-actions__primary" disabled={!name.trim()} onClick={addFree}>
              افزودن به سفارش
            </button>
          </div>
        </>
      )}
      {error && <p className="field__error">{error}</p>}
    </BottomSheet>
  );
}
