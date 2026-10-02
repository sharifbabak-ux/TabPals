import { useEffect } from "react";
import "./Toast.css";

interface ToastProps {
  /** The message to show; null/empty hides the toast. */
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
}

/** A brief bottom toast ("لینک کپی شد") that dismisses itself. */
export function Toast({ message, onDismiss, durationMs = 2500 }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss, durationMs]);

  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
