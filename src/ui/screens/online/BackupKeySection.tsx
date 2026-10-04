import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/data/db";
import { onlineService } from "@/data/online/onlineService";
import { parseBackupText } from "@/data/crypto";
import { clipboardService, qrService } from "@/platform";
import type { QrImage } from "@/platform/types";
import { Toast } from "@/ui/components/Toast";
import "./online.css";

/** «کلید پشتیبان» (show QR + text, optional passphrase) and «بازیابی با کلید پشتیبان» — docs/PLAN.md "Backup key". */
export function BackupKeySection({ eventId }: { eventId: string }) {
  const hasKey = useLiveQuery(async () => Boolean((await db.eventKeys.get(eventId))?.verified), [eventId]);
  const [shown, setShown] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [qr, setQr] = useState<QrImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [restoreText, setRestoreText] = useState("");
  const [restorePass, setRestorePass] = useState("");
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  useEffect(() => {
    if (!shown || !hasKey) {
      setText(null);
      setQr(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const backup = await onlineService.exportBackupKey(eventId, passphrase.trim() || undefined);
        if (cancelled) return;
        setText(backup);
        setQr(backup ? await qrService.render(backup) : null);
      } catch {
        if (!cancelled) setError("ساخت کلید پشتیبان ناموفق بود.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shown, hasKey, eventId, passphrase]);

  const needsPassphrase = parseBackupText(restoreText)?.protectedByPassphrase ?? false;

  async function restore() {
    setRestoreBusy(true);
    setError(null);
    try {
      await onlineService.restoreBackupKey(eventId, restoreText.trim(), restorePass || undefined);
      setRestoreText("");
      setRestorePass("");
      setRestoreOpen(false);
      setToast("کلید بازیابی شد.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "بازیابی ناموفق بود");
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <>
      <h2 className="section-title">کلید پشتیبان</h2>
      <div className="online-card">
        <p className="field__warning">
          اگر همه‌ی دستگاه‌هایی که کلید رمزگذاری را دارند گم یا پاک شوند، اطلاعات رمزگذاری‌شده (شماره کارت، شبا، تلفن، صورت‌حساب‌ها) دیگر قابل‌بازیابی نیست. کلید پشتیبان را جای امن نگه دارید و با کسی که نباید ببیند به اشتراک نگذارید.
        </p>
        {!hasKey ? (
          <p className="field__hint">این دستگاه هنوز کلید را ندارد؛ پس از دریافت کلید می‌توانید نسخه‌ی پشتیبان بگیرید.</p>
        ) : !shown ? (
          <button type="button" className="form-actions__secondary" onClick={() => setShown(true)}>
            نمایش کلید پشتیبان
          </button>
        ) : (
          <>
            <div className="field">
              <label htmlFor="backup-pass">گذرواژه‌ی محافظ (اختیاری)</label>
              <input id="backup-pass" type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
              <p className="field__hint">با گذرواژه، کلید پشتیبان بدون آن گذرواژه قابل‌استفاده نیست؛ گذرواژه را فراموش نکنید.</p>
            </div>
            {qr ? <img className="invite-qr" src={qr.dataUrl} alt="QR کلید پشتیبان" width={240} height={240} /> : <p className="field__hint">برای QR بیش‌ازحد طولانی است؛ از متن استفاده کنید.</p>}
            <div className="invite-link" dir="ltr" data-testid="backup-key-text">
              {text ?? "…"}
            </div>
            <div className="form-actions">
              <button type="button" className="form-actions__secondary" onClick={() => setShown(false)}>
                پنهان کردن
              </button>
              <button
                type="button"
                className="form-actions__primary"
                disabled={!text}
                onClick={async () => setToast(text && (await clipboardService.copyText(text)) ? "کلید کپی شد" : "کپی انجام نشد")}
              >
                کپی متن کلید
              </button>
            </div>
          </>
        )}
      </div>

      <h2 className="section-title">بازیابی با کلید پشتیبان</h2>
      <div className="online-card">
        {!restoreOpen ? (
          <button type="button" className="form-actions__secondary" onClick={() => setRestoreOpen(true)}>
            بازیابی با کلید پشتیبان
          </button>
        ) : (
          <>
            <div className="field">
              <label htmlFor="restore-text">متن کلید پشتیبان</label>
              <textarea id="restore-text" dir="ltr" rows={3} value={restoreText} onChange={(e) => setRestoreText(e.target.value)} />
            </div>
            {needsPassphrase && (
              <div className="field">
                <label htmlFor="restore-pass">گذرواژه</label>
                <input id="restore-pass" type="password" autoComplete="off" value={restorePass} onChange={(e) => setRestorePass(e.target.value)} />
              </div>
            )}
            <div className="form-actions">
              <button type="button" className="form-actions__secondary" onClick={() => setRestoreOpen(false)}>
                انصراف
              </button>
              <button type="button" className="form-actions__primary" disabled={restoreBusy || !parseBackupText(restoreText)} onClick={restore}>
                {restoreBusy ? "در حال بازیابی…" : "بازیابی"}
              </button>
            </div>
          </>
        )}
      </div>
      {error && <p className="field__error">{error}</p>}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
