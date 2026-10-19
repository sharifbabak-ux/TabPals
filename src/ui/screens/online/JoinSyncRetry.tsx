import { useState } from "react";
import { onlineService } from "@/data/online/onlineService";

interface JoinSyncRetryProps {
  eventId: string;
  error: string;
  /** Called when the event has finally been downloaded. */
  onSynced: (eventId: string) => void;
  /** «بعداً»: the device stays joined; the event is listed and keeps syncing in the background. */
  onLater: () => void;
}

/** Shown when the invite was accepted but the first download of the event failed: nothing is lost, the user can retry. */
export function JoinSyncRetry({ eventId, error, onSynced, onLater }: JoinSyncRetryProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error);

  async function retry() {
    setBusy(true);
    try {
      const result = await onlineService.retryJoinSync(eventId);
      if (result.synced) onSynced(eventId);
      else setMessage(result.error);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alert">
      <p className="field__error">
        دعوت پذیرفته شد، اما اطلاعات ایونت هنوز کامل دریافت نشده است. اینترنت را بررسی کنید و دوباره تلاش کنید. ({message})
      </p>
      <div className="form-actions">
        <button type="button" className="form-actions__secondary" disabled={busy} onClick={onLater}>
          بعداً
        </button>
        <button type="button" className="form-actions__primary" disabled={busy} onClick={retry}>
          {busy ? "در حال دریافت…" : "تلاش دوباره"}
        </button>
      </div>
    </div>
  );
}
