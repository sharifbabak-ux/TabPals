import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { onlineService } from "@/data/online/onlineService";
import { toPersianDigits } from "@/domain/format";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { useSyncStatus } from "@/ui/hooks/useSyncStatus";
import "./online.css";

interface GoOnlineSheetProps {
  open: boolean;
  eventId: string;
  onClose: () => void;
}

/** «آنلاین کردن ایونت»: explains what is shared, creates the event on the server and uploads the existing data with a progress bar (resumable). */
export function GoOnlineSheet({ open, eventId, onClose }: GoOnlineSheetProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = useLiveQuery(async () => (await db.onlineLinks.get(eventId)) ?? null, [eventId]);
  const status = useSyncStatus(eventId);

  const started = Boolean(link);
  const finished = link?.status === "online";

  async function handleStart() {
    setBusy(true);
    setError(null);
    try {
      await onlineService.goOnline(eventId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    } finally {
      setBusy(false);
    }
  }

  const percent = status.upload ? Math.round((status.upload.done / Math.max(1, status.upload.total)) * 100) : finished ? 100 : 0;

  return (
    <BottomSheet open={open} title="آنلاین کردن ایونت" onClose={onClose}>
      {!started && (
        <>
          <p>با آنلاین کردن، اعضای ایونت می‌توانند با دعوت‌نامه وارد شوند و سندها، تراز حساب‌ها، سفارش‌ها و صورت‌حساب‌ها را به‌صورت زنده (فقط‌خواندنی) ببینند.</p>
          <div className="online-card">
            <h3>چه چیزی به اشتراک گذاشته می‌شود؟</h3>
            <p className="field__hint">عنوان و تاریخ ایونت، نام اعضا، اسناد، سفارش‌های گروهی و صورت‌حساب‌های صادرشده.</p>
          </div>
          <div className="online-card">
            <h3>چه چیزی فقط روی این دستگاه می‌ماند؟</h3>
            <p className="field__hint">
              فعلاً شماره‌کارت، شبا، نام بانک و صاحب حساب، شماره‌ی تلفن، عکس‌ها و عکس منو هرگز به سرور فرستاده نمی‌شوند و فقط روی همین دستگاه می‌مانند. (در نسخه‌ی بعد با رمزنگاری سرتاسری امکان اشتراک امن آن‌ها فراهم می‌شود.)
            </p>
          </div>
          {error && <p className="field__error">{error}</p>}
          <div className="form-actions">
            <button type="button" className="form-actions__secondary" onClick={onClose}>
              انصراف
            </button>
            <button type="button" className="form-actions__primary" disabled={busy} onClick={handleStart}>
              {busy ? "در حال ساخت…" : "آنلاین کن"}
            </button>
          </div>
        </>
      )}

      {started && (
        <>
          <p>{finished ? "ایونت آنلاین شد ✓" : "در حال بارگذاری اطلاعات ایونت…"}</p>
          <div className="online-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="online-progress__bar" style={{ width: `${percent}%` }} />
          </div>
          <p className="field__hint">
            {status.upload ? `${toPersianDigits(status.upload.done)} از ${toPersianDigits(status.upload.total)}` : `${toPersianDigits(percent)}٪`}
          </p>
          {!finished && <p className="field__hint">اگر اینترنت قطع شود یا برنامه بسته شود، بارگذاری از همان‌جا ادامه پیدا می‌کند.</p>}
          {status.lastError && !finished && <p className="field__error">{status.lastError}</p>}
          <div className="form-actions">
            <button type="button" className="form-actions__primary" onClick={onClose}>
              {finished ? "تمام" : "بستن (ادامه در پس‌زمینه)"}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  );
}
