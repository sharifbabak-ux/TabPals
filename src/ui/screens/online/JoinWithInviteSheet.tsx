import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { onlineService } from "@/data/online/onlineService";
import { formatShortCode, isValidShortCode, normalizeShortCode, parseInviteToken } from "@/domain/inviteLink";
import { qrScanService } from "@/platform";
import { BottomSheet } from "@/ui/components/BottomSheet";
import "./online.css";

interface JoinWithInviteSheetProps {
  open: boolean;
  onClose: () => void;
  /** Pre-filled short code (e.g. copied from the install page). */
  initialCode?: string;
}

/** «پیوستن با دعوت»: scan the invite QR with the camera or type the 8-character code, redeem, catch up and open the event. */
export function JoinWithInviteSheet({ open, onClose, initialCode = "" }: JoinWithInviteSheetProps) {
  const navigate = useNavigate();
  const [code, setCode] = useState(formatShortCode(initialCode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopRef = useRef<(() => void) | null>(null);

  function stopScan() {
    stopRef.current?.();
    stopRef.current = null;
    setScanning(false);
  }

  useEffect(() => {
    if (!open) stopScan();
    return () => {
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [open]);

  async function redeem(input: { inviteToken?: string; shortCode?: string }) {
    setBusy(true);
    setError(null);
    try {
      const localEventId = await onlineService.joinWithInvite(input);
      onClose();
      navigate(`/events/${localEventId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "پیوستن ناموفق بود");
    } finally {
      setBusy(false);
    }
  }

  async function startScan() {
    setError(null);
    setScanning(true);
    // wait a tick so the <video> element is mounted
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!videoRef.current) return;
    try {
      stopRef.current = await qrScanService.start(videoRef.current, (text) => {
        stopRef.current = null;
        setScanning(false);
        const token = parseInviteToken(text);
        if (token) void redeem({ inviteToken: token });
        else if (isValidShortCode(text)) void redeem({ shortCode: normalizeShortCode(text) });
        else setError("این QR مربوط به دعوت‌نامه‌ی TabPals نیست.");
      });
    } catch (e) {
      setScanning(false);
      setError(e instanceof Error ? e.message : "اسکن ممکن نشد");
    }
  }

  return (
    <BottomSheet open={open} title="پیوستن با دعوت" onClose={onClose}>
      <p className="field__hint">QR دعوت‌نامه را با دوربین اسکن کنید یا کد ۸ حرفی را وارد کنید.</p>

      {scanning ? (
        <>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} className="scan-video" muted playsInline />
          <div className="form-actions">
            <button type="button" className="form-actions__secondary" onClick={stopScan}>
              توقف اسکن
            </button>
          </div>
        </>
      ) : (
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" disabled={busy || !qrScanService.isSupported()} onClick={startScan}>
            اسکن QR با دوربین
          </button>
        </div>
      )}

      <div className="field">
        <label htmlFor="invite-code">کد دعوت</label>
        <input
          id="invite-code"
          dir="ltr"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          placeholder="ABCD-2345"
          value={code}
          onChange={(event) => setCode(formatShortCode(event.target.value))}
          style={{ textAlign: "center", letterSpacing: "0.15em", fontSize: "1.3rem" }}
        />
      </div>
      {error && <p className="field__error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="form-actions__secondary" onClick={onClose}>
          انصراف
        </button>
        <button type="button" className="form-actions__primary" disabled={busy || !isValidShortCode(code)} onClick={() => redeem({ shortCode: normalizeShortCode(code) })}>
          {busy ? "در حال پیوستن…" : "پیوستن"}
        </button>
      </div>
    </BottomSheet>
  );
}
