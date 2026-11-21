import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BottomSheet } from "./BottomSheet";
import "./HelpHint.css";

interface HelpHintProps {
  /** Short Persian title (also the bottom-sheet title). */
  title: string;
  /** Short Persian explanation. */
  body: string;
  /** Accessible name of the button; defaults to «راهنما: <title>». */
  label?: string;
}

const COMPACT_QUERY = "(hover: none), (pointer: coarse), (max-width: 640px)";

/** Touch or narrow screen → explanation in a bottom sheet; otherwise a tooltip. */
function isCompactScreen(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COMPACT_QUERY).matches;
}

/**
 * The small «ⓘ» help button (docs/PLAN.md decision 8). Phone: opens a bottom
 * sheet. Desktop: tooltip on hover and keyboard focus, and toggled by click.
 * Esc closes either. Reusable anywhere: `<HelpHint title="…" body="…" />`.
 */
export function HelpHint({ title, body, label }: HelpHintProps) {
  const tipId = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const tipVisible = !dismissed && (hover || focus || pinned);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    buttonRef.current?.focus();
  }, []);

  const hideTip = useCallback(() => {
    setHover(false);
    setPinned(false);
    setDismissed(true);
  }, []);

  // Esc closes whatever is open. Registered in the capture phase on window so a hint
  // inside another sheet closes only itself, not the sheet around it.
  useEffect(() => {
    if (!sheetOpen && !tipVisible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      if (sheetOpen) closeSheet();
      else hideTip();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [sheetOpen, tipVisible, closeSheet, hideTip]);

  // A pinned tooltip closes when tapping/clicking elsewhere or scrolling.
  useEffect(() => {
    if (!tipVisible) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) hideTip();
    };
    const onScroll = () => hideTip();
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [tipVisible, hideTip]);

  // Keep the tooltip fully inside the viewport (360px phones in a desktop-sized window, RTL or LTR).
  useLayoutEffect(() => {
    if (!tipVisible || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
    setPos({ top: rect.bottom + 8, left, width });
  }, [tipVisible]);

  function handleClick(event: React.MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    if (isCompactScreen()) {
      setSheetOpen(true);
      return;
    }
    if (tipVisible) hideTip();
    else {
      setDismissed(false);
      setPinned(true);
    }
  }

  const accessibleName = label ?? `راهنما: ${title}`;

  return (
    <span className="help-hint" ref={wrapperRef}>
      <button
        ref={buttonRef}
        type="button"
        className="help-hint__button"
        aria-label={accessibleName}
        aria-describedby={tipVisible ? tipId : undefined}
        aria-expanded={sheetOpen || tipVisible}
        onClick={handleClick}
        onMouseEnter={() => {
          if (isCompactScreen()) return;
          setDismissed(false);
          setHover(true);
        }}
        onMouseLeave={() => setHover(false)}
        onFocus={() => {
          if (isCompactScreen()) return;
          setDismissed(false);
          setFocus(true);
        }}
        onBlur={() => setFocus(false)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" />
          <path d="M12 11v5.5" />
          <circle cx="12" cy="7.8" r="0.6" fill="currentColor" />
        </svg>
      </button>
      {tipVisible &&
        createPortal(
          <div
            id={tipId}
            role="tooltip"
            className="help-hint__tooltip"
            style={pos ? { top: pos.top, left: pos.left, width: pos.width } : { visibility: "hidden" }}
          >
            <strong>{title}</strong>
            <span>{body}</span>
          </div>,
          document.body
        )}
      {sheetOpen &&
        createPortal(
          <BottomSheet open title={title} onClose={closeSheet}>
            <p className="help-hint__body">{body}</p>
          </BottomSheet>,
          document.body
        )}
    </span>
  );
}
