import { useEffect, type ReactNode } from "react";
import "./BottomSheet.css";

interface BottomSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Full-screen instead of a partial-height sheet — used for long-form editing (e.g. templates), see docs/PLAN.md Stage 3B.1. */
  fullScreen?: boolean;
}

/** A mobile-first bottom sheet used for forms and checklists across the app. */
export function BottomSheet({ open, title, onClose, children, fullScreen = false }: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div
        className={`sheet${fullScreen ? " sheet--full-screen" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__handle" />
        <div className="sheet__header">
          <h2>{title}</h2>
          <button type="button" className="sheet__close" onClick={onClose} aria-label="بستن">
            ×
          </button>
        </div>
        <div className="sheet__body">{children}</div>
      </div>
    </div>
  );
}
