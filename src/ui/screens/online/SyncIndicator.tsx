import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { syncEngine } from "@/data/online/syncEngine";
import { entityLabel, opTypeLabel } from "@/domain/onlineErrors";
import { toPersianDigits } from "@/domain/format";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { useSyncStatus } from "@/ui/hooks/useSyncStatus";
import "./online.css";

/** Small status indicator on online events: آنلاین / آفلاین / در حال همگام‌سازی / «n تغییر در صف». Tap opens the details. */
export function SyncIndicator({ eventId, canSeeRejected }: { eventId: string; canSeeRejected: boolean }) {
  const status = useSyncStatus(eventId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const rejected = useLiveQuery(() => db.outbox.where("localEventId").equals(eventId).filter((r) => Boolean(r.rejected)).toArray(), [eventId]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`sync-indicator sync-indicator--${status.view.kind}${status.view.hasRejected && canSeeRejected ? " sync-indicator--warn" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="وضعیت همگام‌سازی"
      >
        <span className="sync-indicator__dot" />
        {status.view.label}
        {status.view.hasRejected && canSeeRejected && ` · ${toPersianDigits(status.rejected)} ردشده`}
      </button>

      <BottomSheet open={open} title="وضعیت همگام‌سازی" onClose={() => setOpen(false)}>
        <p>
          وضعیت: <strong>{status.view.label}</strong>
        </p>
        {status.upload && (
          <>
            <p>
              در حال بارگذاری اطلاعات ایونت: {toPersianDigits(status.upload.done)} از {toPersianDigits(status.upload.total)}
            </p>
            <div className="online-progress" role="progressbar" aria-valuenow={status.upload.done} aria-valuemax={status.upload.total}>
              <div className="online-progress__bar" style={{ width: `${Math.round((status.upload.done / Math.max(1, status.upload.total)) * 100)}%` }} />
            </div>
          </>
        )}
        <p>تغییرهای در صف ارسال: {toPersianDigits(status.pending)}</p>
        {status.lastError && <p className="field__error">{status.lastError}</p>}

        {canSeeRejected && rejected && rejected.length > 0 && (
          <>
            <h3 className="section-title">تغییرهای ردشده توسط سرور</h3>
            <ul className="online-list">
              {rejected.map((row) => (
                <li key={row.opId} className="online-list__row">
                  <span>
                    {opTypeLabel(row.op.type)} {entityLabel(row.op.entity)}
                  </span>
                  <span className="field__error">{row.rejected?.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={() => setOpen(false)}>
            بستن
          </button>
          <button
            type="button"
            className="form-actions__primary"
            disabled={busy}
            onClick={() => run(() => (canSeeRejected && status.rejected > 0 ? syncEngine.retryRejected(eventId) : syncEngine.syncNow(eventId)))}
          >
            تلاش دوباره
          </button>
        </div>
      </BottomSheet>
    </>
  );
}
