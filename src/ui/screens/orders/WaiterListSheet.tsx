import { useMemo, useState } from "react";
import { orderSessionsRepository } from "@/data/repositories";
import { buildWaiterListText, buildWaiterListWhatsAppText, buildWaiterSections, groupWaiterListByCategory, waiterListShowsHeadings, type WaiterItem } from "@/domain/groupOrder";
import { ORDER_CATEGORY_LABELS } from "@/domain/orderCategory";
import { toPersianDigits } from "@/domain/format";
import { clipboardService, shareService } from "@/platform";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { Toast } from "@/ui/components/Toast";
import type { OrderSessionData } from "./useOrderSession";
import { captureWaiterListImages } from "./waiterListExport";

interface WaiterListSheetProps {
  open: boolean;
  data: OrderSessionData;
  /** The admin can mark items delivered / undo; everyone else just sees the list (a view, not a role). */
  canMarkDelivered?: boolean;
  onClose: () => void;
}

/**
 * «فهرست گارسون» v2 (docs/PLAN.md ONLINE-2, O2-2): «جدید» vs «تحویل‌شده» with one-tap
 * delivered / undo, plus image and WhatsApp-text export.
 */
export function WaiterListSheet({ open, data, canMarkDelivered = false, onClose }: WaiterListSheetProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sections = useMemo(() => buildWaiterSections(data.lines), [data.lines]);
  const title = `${data.session.title}${data.session.restaurant ? ` – ${data.session.restaurant}` : ""}`;
  const hasAny = sections.fresh.length + sections.delivered.length > 0;
  // Share what still has to be ordered; when everything is delivered, share the full list.
  const shareItems = sections.fresh.length > 0 ? sections.fresh : sections.delivered;
  const whatsappText = useMemo(() => buildWaiterListWhatsAppText(title, shareItems, sections.fresh.length > 0 ? "سفارش جدید" : "سفارش"), [title, shareItems, sections.fresh.length]);
  const plainText = useMemo(() => buildWaiterListText(title, shareItems), [title, shareItems]);

  async function mark(item: WaiterItem, delivered: boolean) {
    try {
      await orderSessionsRepository.setLinesDelivered(item.lineIds, delivered);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  async function markAll(items: WaiterItem[]) {
    try {
      await orderSessionsRepository.setLinesDelivered(items.flatMap((i) => i.lineIds), true);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  async function handleCopy() {
    setToast((await clipboardService.copyText(plainText)) ? "فهرست کپی شد" : "کپی انجام نشد");
  }

  async function handleShareWhatsApp() {
    try {
      await shareService.shareText(whatsappText, title);
    } catch {
      // The user dismissed the share sheet.
    }
  }

  async function handleShareImage() {
    setBusy(true);
    try {
      const files = await captureWaiterListImages(title, shareItems, "waiter-list");
      if (files.length === 0) {
        setToast("ساخت تصویر ناموفق بود");
        return;
      }
      await shareService.shareFiles(files.map((f) => ({ data: f.blob, filename: f.filename, mimeType: f.mimeType })));
    } catch {
      // The user dismissed the share sheet, or the browser cannot share files.
      setToast("ارسال تصویر انجام نشد");
    } finally {
      setBusy(false);
    }
  }

  function renderItems(items: WaiterItem[], delivered: boolean) {
    const groups = groupWaiterListByCategory(items);
    return groups.map((group) => (
      <section key={group.category}>
        {waiterListShowsHeadings(groups) && <h3 className="waiter-list__heading">{ORDER_CATEGORY_LABELS[group.category]}</h3>}
        <ul className="waiter-list">
          {group.items.map((item) => (
            <li key={item.key} className={`waiter-list__row${delivered ? " waiter-list__row--delivered" : ""}`}>
              <span className="waiter-list__line">
                <span className="waiter-list__qty">{toPersianDigits(item.quantity)} ×</span> {item.name}
              </span>
              {item.notes.map((note) => (
                <span key={note.text} className="waiter-list__note">
                  ↳ {note.text}
                  {note.quantity !== item.quantity ? ` (${toPersianDigits(note.quantity)})` : ""}
                </span>
              ))}
              {canMarkDelivered && (
                <button type="button" className="waiter-list__toggle" onClick={() => mark(item, !delivered)}>
                  {delivered ? "برگشت به جدید" : "✓ تحویل شد"}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    ));
  }

  return (
    <BottomSheet open={open} title="فهرست گارسون" onClose={onClose}>
      {!hasAny ? (
        <p className="field__hint">هنوز سفارشی ثبت نشده است.</p>
      ) : (
        <>
          <div className="waiter-list__section-head">
            <h3 className="waiter-list__section-title">جدید ({toPersianDigits(sections.fresh.reduce((s, i) => s + i.quantity, 0))})</h3>
            {canMarkDelivered && sections.fresh.length > 0 && (
              <button type="button" className="waiter-list__toggle" onClick={() => markAll(sections.fresh)}>
                همه تحویل شد
              </button>
            )}
          </div>
          {sections.fresh.length === 0 ? <p className="field__hint">مورد جدیدی نیست.</p> : renderItems(sections.fresh, false)}

          {sections.delivered.length > 0 && (
            <>
              <div className="waiter-list__section-head">
                <h3 className="waiter-list__section-title">تحویل‌شده ({toPersianDigits(sections.delivered.reduce((s, i) => s + i.quantity, 0))})</h3>
              </div>
              {renderItems(sections.delivered, true)}
            </>
          )}

          <div className="form-actions">
            <button type="button" className="form-actions__secondary" onClick={handleCopy}>
              کپی
            </button>
            <button type="button" className="form-actions__secondary" disabled={busy} onClick={handleShareImage}>
              ارسال تصویر
            </button>
            <button type="button" className="form-actions__primary" onClick={handleShareWhatsApp}>
              ارسال پیام واتساپ
            </button>
          </div>
        </>
      )}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </BottomSheet>
  );
}
