import { useEffect, useState } from "react";
import { APP_NAME } from "@/config/app";
import { onlineService } from "@/data/online/onlineService";
import { buildInviteMessage, formatShortCode } from "@/domain/inviteLink";
import { buildSmsUrl, buildTelegramUrl, buildWhatsAppUrl } from "@/domain/sendUrls";
import { clipboardService, platform, qrService, shareService } from "@/platform";
import type { QrImage } from "@/platform/types";
import { BottomSheet } from "@/ui/components/BottomSheet";
import { JalaliDate } from "@/ui/components/JalaliDate";
import { Toast } from "@/ui/components/Toast";
import "./online.css";

interface InviteSheetProps {
  open: boolean;
  eventId: string;
  eventTitle: string;
  member: { personId: string; name: string } | null;
  /** Create the invite as soon as the sheet opens (used after the admin already confirmed, e.g. «جایگزینی دستگاه»). Default: wait for a tap, so opening the sheet never leaves an unused valid invite on the server. */
  autoCreate?: boolean;
  onClose: () => void;
}

interface CreatedInvite {
  url: string;
  shortCode: string;
  expiresAt: string;
}

/** Invite sheet for one member: link, offline QR, big short code, copy/share/WhatsApp/Telegram/SMS, expiry. The server shows token and code only once, so this is the only chance to hand them over. */
export function InviteSheet({ open, eventId, eventTitle, member, autoCreate = false, onClose }: InviteSheetProps) {
  const [requested, setRequested] = useState(false);
  const [tries, setTries] = useState(0);
  const [invite, setInvite] = useState<CreatedInvite | null>(null);
  const [qr, setQr] = useState<QrImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const personId = member?.personId;
  useEffect(() => {
    if (!open) setRequested(false);
    if (!open || !personId || !(autoCreate || requested)) return;
    let cancelled = false;
    setInvite(null);
    setQr(null);
    setError(null);
    (async () => {
      try {
        const created = await onlineService.createInvite(eventId, personId);
        if (cancelled) return;
        setInvite({ url: created.url, shortCode: created.shortCode, expiresAt: created.expiresAt });
        setQr(await qrService.render(created.url));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "ساخت دعوت‌نامه ناموفق بود");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, eventId, personId, autoCreate, requested, tries]);

  // a different member → ask again
  useEffect(() => {
    setRequested(false);
    setInvite(null);
    setQr(null);
    setError(null);
  }, [personId]);

  const message = invite && member ? buildInviteMessage(APP_NAME, eventTitle, member.name, invite.url, invite.shortCode) : "";

  async function copyLink() {
    if (!invite) return;
    setToast((await clipboardService.copyText(invite.url)) ? "لینک کپی شد" : "کپی انجام نشد");
  }

  async function share() {
    if (!invite) return;
    try {
      if (shareService.isSupported()) await shareService.shareText(message, `دعوت به ${eventTitle}`);
      else await copyLink();
    } catch {
      // the user closed the share sheet
    }
  }

  return (
    <BottomSheet open={open} title={member ? `دعوت ${member.name}` : "دعوت"} onClose={onClose}>
      {error && <p className="field__error">{error}</p>}
      {!invite && !error && !autoCreate && !requested && (
        <>
          <p className="field__hint">با زدن دکمه‌ی زیر یک دعوت‌نامه‌ی یک‌بارمصرف (۷ روز اعتبار) برای {member?.name} ساخته می‌شود.</p>
          <div className="form-actions">
            <button type="button" className="form-actions__primary" onClick={() => setRequested(true)}>
              ساخت دعوت‌نامه
            </button>
          </div>
        </>
      )}
      {!invite && !error && (autoCreate || requested) && <p className="field__hint">در حال ساخت دعوت‌نامه…</p>}
      {error && (
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={() => {
              setRequested(true);
              setTries((n) => n + 1);
            }}>
            تلاش دوباره
          </button>
        </div>
      )}
      {invite && (
        <div className="invite-sheet">
          {qr ? <img className="invite-qr" src={qr.dataUrl} alt="QR دعوت‌نامه" width={240} height={240} /> : <p className="field__hint">لینک برای QR بیش‌ازحد طولانی است؛ از لینک یا کد استفاده کنید.</p>}
          <div>
            <p className="field__hint" style={{ textAlign: "center", margin: 0 }}>
              کد دعوت
            </p>
            <div className="invite-code" aria-label="کد دعوت">
              {formatShortCode(invite.shortCode)}
            </div>
          </div>
          <p className="field__hint">
            این دعوت یک‌بار مصرف است و تا <JalaliDate date={new Date(invite.expiresAt)} weekday time /> اعتبار دارد.
          </p>
          <div className="invite-link">{invite.url}</div>
          <div className="invite-actions">
            <button type="button" onClick={copyLink}>
              کپی لینک
            </button>
            <button type="button" onClick={share}>
              اشتراک‌گذاری
            </button>
            <button type="button" onClick={() => shareService.openUrl(buildWhatsAppUrl(null, message))}>
              واتس‌اپ
            </button>
            <button type="button" onClick={() => shareService.openUrl(buildTelegramUrl(invite.url, message))}>
              تلگرام
            </button>
            <button type="button" onClick={() => shareService.openUrl(buildSmsUrl(null, message, platform.getInfo().os === "ios"))}>
              پیامک
            </button>
          </div>
        </div>
      )}
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </BottomSheet>
  );
}
