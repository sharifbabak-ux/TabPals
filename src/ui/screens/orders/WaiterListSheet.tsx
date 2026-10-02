import { useMemo, useState } from "react";
import { buildWaiterList, buildWaiterListText } from "@/domain/groupOrder";
import { toPersianDigits } from "@/domain/format";
import { clipboardService, shareService } from "@/platform";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { Toast } from "@/ui/components/Toast";
import type { OrderSessionData } from "./useOrderSession";

interface WaiterListSheetProps {
  open: boolean;
  data: OrderSessionData;
  onClose: () => void;
}

/** «فهرست گارسون»: large, clear "۳ × کوبیده" list with copy and share-as-text (docs/PLAN.md Group Order UI #7). */
export function WaiterListSheet({ open, data, onClose }: WaiterListSheetProps) {
  const [toast, setToast] = useState<string | null>(null);
  const items = useMemo(() => buildWaiterList(data.lines), [data.lines]);
  const title = `${data.session.title}${data.session.restaurant ? ` – ${data.session.restaurant}` : ""}`;
  const text = useMemo(() => buildWaiterListText(title, items), [title, items]);

  async function handleCopy() {
    setToast((await clipboardService.copyText(text)) ? "فهرست کپی شد" : "کپی انجام نشد");
  }

  async function handleShare() {
    try {
      await shareService.shareText(text, title);
    } catch {
      // The user dismissed the share sheet.
    }
  }

  return (
    <BottomSheet open={open} title="فهرست گارسون" onClose={onClose}>
      {items.length === 0 ? (
        <p className="field__hint">هنوز سفارشی ثبت نشده است.</p>
      ) : (
        <>
          <p className="field__hint">
            مجموع: {toPersianDigits(items.reduce((s, i) => s + i.quantity, 0))} مورد در {toPersianDigits(items.length)} قلم
          </p>
          <ul className="waiter-list">
            {items.map((item) => (
              <li key={item.key} className="waiter-list__row">
                <span className="waiter-list__line">
                  <span className="waiter-list__qty">{toPersianDigits(item.quantity)} ×</span> {item.name}
                </span>
                {item.notes.map((note) => (
                  <span key={note.text} className="waiter-list__note">
                    ↳ {note.text}
                    {note.quantity !== item.quantity ? ` (${toPersianDigits(note.quantity)})` : ""}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <button type="button" className="form-actions__secondary" onClick={handleCopy}>
              کپی
            </button>
            <button type="button" className="form-actions__primary" onClick={handleShare}>
              ارسال به‌صورت متن
            </button>
          </div>
        </>
      )}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </BottomSheet>
  );
}
