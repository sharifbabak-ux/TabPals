import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import type { Event } from "@/data/types";
import { eventsRepository } from "@/data/repositories";
import { EmptyState } from "@/ui/components/EmptyState";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { BottomSheet } from "@/ui/components/BottomSheet";

/** Settings → "سطل بازیافت" (docs/PLAN.md Stage 3B.1): trashed (deletedAt-set) events, restore, and type-to-confirm permanent delete. */
export function TrashScreen() {
  const navigate = useNavigate();
  const [restoreTarget, setRestoreTarget] = useState<Event | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Event | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const trashedEvents = useLiveQuery(() => db.events.filter((e) => !e.deleted && Boolean(e.deletedAt)).toArray(), []);
  const sorted = useMemo(
    () => (trashedEvents ?? []).slice().sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "")),
    [trashedEvents]
  );

  async function handleRestore() {
    if (!restoreTarget) return;
    await eventsRepository.restoreFromTrash(restoreTarget.id);
    setRestoreTarget(null);
  }

  async function handlePermanentDelete() {
    if (!deleteTarget || confirmText !== deleteTarget.title) return;
    setBusy(true);
    setError(null);
    try {
      await eventsRepository.permanentlyDelete(deleteTarget.id);
      setDeleteTarget(null);
      setConfirmText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <button type="button" className="back-link" onClick={() => navigate("/settings")}>
        ← بازگشت به تنظیمات
      </button>
      <h1>سطل بازیافت</h1>

      {sorted.length === 0 && <EmptyState hint="سطل بازیافت خالی است." />}

      <ul className="list">
        {sorted.map((event) => (
          <li key={event.id} className="list-item trash-row">
            <div className="list-item__main">
              <span className="list-item__title">{event.title}</span>
              <span className="list-item__subtitle">
                تاریخ حذف: <JalaliDate date={new Date(event.deletedAt!)} />
              </span>
            </div>
            <div className="list-item__meta trash-row__actions">
              <button type="button" className="list-item__action" onClick={() => setRestoreTarget(event)}>
                بازگردانی
              </button>
              <button
                type="button"
                className="list-item__action trash-row__delete"
                onClick={() => {
                  setDeleteTarget(event);
                  setConfirmText("");
                  setError(null);
                }}
              >
                حذف دائمی
              </button>
            </div>
          </li>
        ))}
      </ul>

      <BottomSheet open={restoreTarget !== null} title="بازگردانی ایونت" onClose={() => setRestoreTarget(null)}>
        <p>«{restoreTarget?.title}» از سطل بازیافت بازگردانده شود؟</p>
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={() => setRestoreTarget(null)}>
            انصراف
          </button>
          <button type="button" className="form-actions__primary" onClick={handleRestore}>
            بازگردانی
          </button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={deleteTarget !== null}
        title="حذف دائمی ایونت"
        onClose={() => {
          setDeleteTarget(null);
          setConfirmText("");
        }}
      >
        <p className="field__warning">
          همه‌ی اسناد و صورت‌حساب‌های «{deleteTarget?.title}» برای همیشه حذف خواهند شد. این عملیات قابل بازگشت نیست.
        </p>
        <div className="field">
          <label htmlFor="trash-confirm-title">برای تأیید، عنوان ایونت («{deleteTarget?.title}») را تایپ کنید</label>
          <input id="trash-confirm-title" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} />
        </div>
        {error && <p className="field__error">{error}</p>}
        <div className="form-actions">
          <button
            type="button"
            className="form-actions__secondary"
            onClick={() => {
              setDeleteTarget(null);
              setConfirmText("");
            }}
          >
            انصراف
          </button>
          <button
            type="button"
            className="form-actions__primary"
            disabled={busy || confirmText !== deleteTarget?.title}
            onClick={handlePermanentDelete}
          >
            حذف دائمی
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
