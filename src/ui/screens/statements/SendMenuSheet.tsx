import { useState } from "react";
import type { SendChannel, Statement } from "@/data/types";
import type { StatementLinkData } from "@/domain/statementLink";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { Toast } from "@/ui/components/Toast";
import { copyStatementLink, memberLabelOf, openSms, openTelegram, openWhatsApp, shareStatementFile, targetOf } from "./sendActions";

interface SendMenuSheetProps {
  open: boolean;
  onClose: () => void;
  statement: Statement;
  data: StatementLinkData;
  eventTitle: string;
  /** The member's raw saved phone number, if any — undefined/null for the comprehensive report. */
  phone?: string | null;
  onSent: (channel: SendChannel, target: string) => void;
}

/** The "ارسال" bottom sheet shown on a statement/report view (docs/PLAN.md Stage 3C SEND MENU). */
export function SendMenuSheet({ open, onClose, statement, data, eventTitle, phone, onSent }: SendMenuSheetProps) {
  const [busy, setBusy] = useState<"pdf" | "image" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isPersonal = data.kind !== "comprehensive";
  const target = targetOf(data);

  async function handleFileShare(kind: "pdf" | "image") {
    setBusy(kind);
    setError(null);
    try {
      const result = await shareStatementFile(statement, data, eventTitle, kind);
      if (result.message) setError(result.message);
      if (result.ok) {
        onSent("share", target);
        if (!result.message) onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطا در آماده‌سازی فایل");
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyLink() {
    const result = await copyStatementLink(statement, data, eventTitle);
    if (result.ok) setToast(result.message);
    else setError(result.message);
  }

  function handleWhatsApp() {
    openWhatsApp(statement, data, eventTitle, phone);
    onSent("whatsapp", target);
    onClose();
  }

  function handleTelegram() {
    openTelegram(statement, data, eventTitle, phone);
    onSent("telegram", target);
    onClose();
  }

  function handleSms() {
    openSms(statement, data, eventTitle, phone);
    onSent("sms", target);
    onClose();
  }

  return (
    <BottomSheet open={open} title={`ارسال ${memberLabelOf(data)}`} onClose={onClose}>
      <ul className="list">
        <li className="list-item" onClick={() => busy === null && handleFileShare("pdf")}>
          <div className="list-item__main">
            <span className="list-item__title">ارسال فایل PDF</span>
            <span className="list-item__subtitle">{busy === "pdf" ? "در حال آماده‌سازی…" : "برای اشتراک یا ذخیره"}</span>
          </div>
        </li>
        <li className="list-item" onClick={() => busy === null && handleFileShare("image")}>
          <div className="list-item__main">
            <span className="list-item__title">ارسال فایل تصویر</span>
            <span className="list-item__subtitle">{busy === "image" ? "در حال آماده‌سازی…" : "مناسب واتس‌اپ و تلگرام"}</span>
          </div>
        </li>
        <li className="list-item" onClick={handleCopyLink}>
          <div className="list-item__main">
            <span className="list-item__title">کپی لینک صورت‌حساب</span>
            <span className="list-item__subtitle">برای چسباندن در هر پیام‌رسان</span>
          </div>
        </li>
        {isPersonal && (
          <>
            <li className="list-item" onClick={handleWhatsApp}>
              <div className="list-item__main">
                <span className="list-item__title">واتس‌اپ (متن خلاصه)</span>
              </div>
            </li>
            <li className="list-item" onClick={handleTelegram}>
              <div className="list-item__main">
                <span className="list-item__title">تلگرام (متن خلاصه)</span>
              </div>
            </li>
            <li className="list-item" onClick={handleSms}>
              <div className="list-item__main">
                <span className="list-item__title">پیامک</span>
              </div>
            </li>
          </>
        )}
      </ul>
      {error && <p className="field__error">{error}</p>}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </BottomSheet>
  );
}
