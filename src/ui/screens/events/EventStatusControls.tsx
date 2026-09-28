import { useState } from "react";
import { eventsRepository } from "@/data/repositories";
import { ConfirmDialog } from "@/ui/components/ConfirmDialog";
import { BottomSheet } from "@/ui/components/BottomSheet";

interface EventStatusControlsProps {
  eventId: string;
  closed: boolean;
}

/** پایان ایونت / بازگشایی ایونت — both are logged operations (docs/PLAN.md item 2, Stage 2 task description part D). */
export function EventStatusControls({ eventId, closed }: EventStatusControlsProps) {
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleClose() {
    await eventsRepository.close(eventId);
    setConfirmingClose(false);
  }

  async function handleReopen() {
    const trimmed = reopenReason.trim();
    if (!trimmed) return;
    try {
      await eventsRepository.reopen(eventId, trimmed);
      setReopening(false);
      setReopenReason("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "خطایی رخ داد");
    }
  }

  return (
    <div className="event-status-bar">
      {closed ? (
        <button type="button" onClick={() => setReopening(true)}>
          بازگشایی ایونت
        </button>
      ) : (
        <button type="button" onClick={() => setConfirmingClose(true)}>
          پایان ایونت
        </button>
      )}

      <ConfirmDialog
        open={confirmingClose}
        title="پایان ایونت"
        message="این ایونت پایان یابد؟ پس از این، ثبت سند جدید ممکن نخواهد بود مگر اینکه دوباره بازگشایی شود."
        confirmLabel="پایان ایونت"
        onConfirm={handleClose}
        onCancel={() => setConfirmingClose(false)}
      />

      <BottomSheet
        open={reopening}
        title="بازگشایی ایونت"
        onClose={() => {
          setReopening(false);
          setReopenReason("");
          setError(null);
        }}
      >
        <div className="field">
          <label htmlFor="reopen-reason">دلیل بازگشایی</label>
          <textarea
            id="reopen-reason"
            className="reason-textarea"
            value={reopenReason}
            onChange={(event) => setReopenReason(event.target.value)}
            autoFocus
          />
        </div>
        {error && <p className="field__error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="form-actions__secondary" onClick={() => setReopening(false)}>
            انصراف
          </button>
          <button type="button" className="form-actions__primary" disabled={!reopenReason.trim()} onClick={handleReopen}>
            بازگشایی
          </button>
        </div>
      </BottomSheet>
    </div>
  );
}
